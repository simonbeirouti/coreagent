import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dagre from 'dagre';
import {
  Background,
  Controls,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import { createFileRoute } from '@tanstack/react-router';
import { Bot, LayoutGrid, Plus, Save, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SkillsGraphNode } from '@/components/skills-graph/skills-graph-node';
import { useAgent } from '@/hooks/useAgents';
import {
  useAgentRegistrySkills,
  useAgentToolSettings,
  useSetAgentAbilityEnabled,
} from '@/hooks/useAbilities';
import { useAssignRegistrySkill, useInstalledSkills } from '@/hooks/useRegistrySkills';
import {
  DEFAULT_SKILLS_GRAPH_EDGE_OPTIONS,
  createSkillsGraphEdge,
  type SkillsGraphNodeData,
} from '@/lib/skills-graph-theme';
import {
  useSaveSkillsGraph,
  useSkillsGraph,
  useSuggestSkillsGraphConnections,
} from '@/hooks/useSkillsGraph';

type EdgeLabelType = 'prereq' | 'related' | 'used_with';
const EDGE_LABEL_OPTIONS: Array<{ value: EdgeLabelType; label: string }> = [
  { value: 'related', label: 'Related' },
  { value: 'prereq', label: 'Prerequisite' },
  { value: 'used_with', label: 'Used with' },
];

const initialViewport = { x: 0, y: 0, zoom: 1 };
const nodeTypes = { skillsGraphNode: SkillsGraphNode };
const graphViewCache = new Map<string, { nodes: Node<SkillsGraphNodeData>[]; edges: Edge[] }>();

type GraphToolSetting = {
  ability_name: string;
  implementation_key: string;
  category: string;
  enabled: boolean;
  is_mandatory: boolean;
  source?: 'core' | 'registry-managed' | 'orchestration-runtime' | 'custom';
};

type AvailableSkillOption = {
  ability_name: string;
  implementation_key: string;
  category: string;
  enabled: boolean;
  is_mandatory: boolean;
};

export const Route = createFileRoute('/agents/$agentId/skills-graph')({
  component: AgentSkillsGraphPage,
});

function normalizeGraphFromStorage(raw: string): { nodes: Node<SkillsGraphNodeData>[]; edges: Edge[] } | null {
  try {
    const parsed = JSON.parse(raw) as {
      nodes?: Node<SkillsGraphNodeData>[];
      edges?: Edge[];
    };
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return null;
  }
}

function getFastHydratedGraph(
  agentId: string,
  localGraphKey: string
): { nodes: Node<SkillsGraphNodeData>[]; edges: Edge[] } {
  const fromMemory = graphViewCache.get(agentId);
  if (fromMemory) {
    return { nodes: fromMemory.nodes, edges: fromMemory.edges };
  }

  const local = localStorage.getItem(localGraphKey);
  if (!local) return { nodes: [], edges: [] };
  const parsed = normalizeGraphFromStorage(local);
  if (!parsed) return { nodes: [], edges: [] };
  return parsed;
}

function layoutGraph(nodes: Node<SkillsGraphNodeData>[], edges: Edge[]): Node<SkillsGraphNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 110, nodesep: 72 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 220, height: 70 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);
  return nodes.map((node) => {
    const positioned = g.node(node.id);
    if (!positioned) return node;
    return {
      ...node,
      position: {
        x: positioned.x - 110,
        y: positioned.y - 35,
      },
    };
  });
}

function positionFromDelta(dx: number, dy: number): Position {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }
  return dy >= 0 ? Position.Bottom : Position.Top;
}

function toInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function toSkillNodeId(key: string) {
  return `skill-${key}`;
}

function isDefaultTool(setting: {
  is_mandatory: boolean;
  source?: 'core' | 'registry-managed' | 'orchestration-runtime' | 'custom';
}) {
  return setting.is_mandatory || setting.source === 'core';
}

function toNodePosition(centerX: number, centerY: number) {
  return { x: centerX - 110, y: centerY - 35 };
}

function positionBand<T extends { position: { x: number; y: number } }>(
  items: T[],
  centerX: number,
  centerY: number
) {
  const spacing = 240;
  const totalWidth = (items.length - 1) * spacing;
  const startCenterX = centerX - totalWidth / 2;
  return items.map((item, index) => ({
    ...item,
    position: toNodePosition(startCenterX + index * spacing, centerY),
  }));
}

function buildGraphFromToolSettings(
  agentId: string,
  agentName: string,
  settings: GraphToolSetting[]
): { nodes: Node<SkillsGraphNodeData>[]; edges: Edge[] } {
  const active = settings.filter((setting) => setting.enabled || setting.is_mandatory);
  if (active.length === 0) {
    return { nodes: [], edges: [] };
  }

  const rootNodeId = `agent-${agentId}`;
  const defaults = active.filter((setting) => isDefaultTool(setting));
  const assigned = active.filter((setting) => !isDefaultTool(setting));
  const defaultNodes: Node<SkillsGraphNodeData>[] = defaults.map((setting, index) => ({
    id: toSkillNodeId(setting.implementation_key),
    type: 'skillsGraphNode',
    position: { x: 260 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 140 },
    data: {
      label: setting.ability_name,
      level: 'advanced',
      kind: 'skill',
      category: setting.category,
    },
  }));
  const assignedNodes: Node<SkillsGraphNodeData>[] = assigned.map((setting, index) => ({
    id: toSkillNodeId(setting.implementation_key),
    type: 'skillsGraphNode',
    position: { x: 260 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 140 },
    data: {
      label: setting.ability_name,
      level: 'intermediate',
      kind: 'skill',
      category: setting.category,
    },
  }));

  const centerX = 560;
  const topBand = positionBand(defaultNodes, centerX, 120);
  const bottomBand = positionBand(assignedNodes, centerX, 420);
  const rootNode: Node<SkillsGraphNodeData> = {
    id: rootNodeId,
    type: 'skillsGraphNode',
    position: toNodePosition(centerX, 270),
    data: {
      label: `${agentName} Skills`,
      level: 'advanced',
      kind: 'agent',
    },
  };

  const nodes: Node<SkillsGraphNodeData>[] = [...topBand, rootNode, ...bottomBand];
  const defaultEdges: Edge[] = topBand.map((node, index) =>
    createSkillsGraphEdge(node.id, rootNodeId, undefined, `default-edge-${index}-${node.id}`)
  );
  const assignedEdges: Edge[] = bottomBand.map((node, index) =>
    createSkillsGraphEdge(rootNodeId, node.id, undefined, `assigned-edge-${index}-${node.id}`)
  );
  const edges: Edge[] = [...defaultEdges, ...assignedEdges];

  // Keep the explicit first-load hierarchy (defaults -> agent -> assigned)
  // and avoid dagre reordering at startup.
  return { nodes, edges };
}

function ActionIconButton({
  label,
  onClick,
  icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          className="border border-border/70 bg-card/90 text-foreground shadow-sm backdrop-blur"
          aria-label={label}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AgentSkillsGraphPage() {
  const { agentId } = Route.useParams();
  const { data: agent } = useAgent(agentId);
  const { data: toolSettings = [], isLoading: isToolSettingsLoading } = useAgentToolSettings(agentId);
  const { data: agentRegistrySkills = [] } = useAgentRegistrySkills(agentId);
  const assignRegistrySkill = useAssignRegistrySkill(agentId);
  const setAgentAbilityEnabled = useSetAgentAbilityEnabled(agentId);
  const { data: installedSkills = [] } = useInstalledSkills();
  const localGraphKey = `coreagent.skills.graph.local.v3.${agentId}`;
  const { data: snapshot, isLoading: isSnapshotLoading } = useSkillsGraph('agent', agentId);
  const saveMutation = useSaveSkillsGraph('agent', agentId);
  const suggestMutation = useSuggestSkillsGraphConnections();
  const initialGraph = useMemo(
    () => getFastHydratedGraph(agentId, localGraphKey),
    [agentId, localGraphKey]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SkillsGraphNodeData>>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialGraph.edges);
  const [defaultEdgeLabel, setDefaultEdgeLabel] = useState<EdgeLabelType>('related');
  const [pendingSuggestedEdges, setPendingSuggestedEdges] = useState<Array<{
    source: string;
    target: string;
    label?: string;
  }>>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  const agentName = agent?.name ?? 'Agent';
  const agentAvatar = (agent as { image_url?: string | null } | undefined)?.image_url ?? null;

  useEffect(() => {
    const fastHydrated = getFastHydratedGraph(agentId, localGraphKey);
    if (fastHydrated.nodes.length > 0 || fastHydrated.edges.length > 0) {
      setNodes(fastHydrated.nodes);
      setEdges(fastHydrated.edges);
    }
  }, [agentId, localGraphKey, setEdges, setNodes]);

  useEffect(() => {
    const hasRemoteGraph =
      Array.isArray(snapshot?.graphJson?.nodes) &&
      Array.isArray(snapshot?.graphJson?.edges) &&
      (snapshot.graphJson.nodes.length > 0 || snapshot.graphJson.edges.length > 0);

    if (hasRemoteGraph) {
      setNodes(snapshot.graphJson.nodes as Node<SkillsGraphNodeData>[]);
      setEdges(snapshot.graphJson.edges as Edge[]);
      return;
    }

    const local = localStorage.getItem(localGraphKey);
    if (local) {
      const parsed = normalizeGraphFromStorage(local);
      if (parsed && (parsed.nodes.length > 0 || parsed.edges.length > 0)) {
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        return;
      }
    }

    if (toolSettings.length > 0) {
      const generated = buildGraphFromToolSettings(agentId, agentName, toolSettings as GraphToolSetting[]);
      setNodes(generated.nodes);
      setEdges(generated.edges);
      return;
    }

    if (isSnapshotLoading || isToolSettingsLoading) {
      // Keep fast-hydrated content rendered while async sources settle.
      return;
    }

    setNodes([]);
    setEdges([]);
  }, [
    agentId,
    agentName,
    localGraphKey,
    setEdges,
    setNodes,
    isSnapshotLoading,
    isToolSettingsLoading,
    snapshot?.graphJson?.edges,
    snapshot?.graphJson?.nodes,
    toolSettings,
  ]);

  useEffect(() => {
    localStorage.setItem(localGraphKey, JSON.stringify({ nodes, edges }));
    graphViewCache.set(agentId, { nodes, edges });
  }, [edges, localGraphKey, nodes]);

  const renderedNodes = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sourceDirection = new Map<string, { dx: number; dy: number; count: number }>();
    const targetDirection = new Map<string, { dx: number; dy: number; count: number }>();

    for (const edge of edges) {
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) continue;

      const dx = targetNode.position.x - sourceNode.position.x;
      const dy = targetNode.position.y - sourceNode.position.y;

      const sourceAccum = sourceDirection.get(sourceNode.id) ?? { dx: 0, dy: 0, count: 0 };
      sourceAccum.dx += dx;
      sourceAccum.dy += dy;
      sourceAccum.count += 1;
      sourceDirection.set(sourceNode.id, sourceAccum);

      const targetAccum = targetDirection.get(targetNode.id) ?? { dx: 0, dy: 0, count: 0 };
      targetAccum.dx -= dx;
      targetAccum.dy -= dy;
      targetAccum.count += 1;
      targetDirection.set(targetNode.id, targetAccum);
    }

    const normalizedSearch = activeSearchTerm.trim().toLowerCase();
    return nodes.map((node) => {
      const nodeLabel = String(node.data?.label ?? '').toLowerCase();
      const matchesSearch = normalizedSearch.length === 0 || nodeLabel.includes(normalizedSearch);
      return {
      ...node,
      type: 'skillsGraphNode',
      draggable: true,
      selectable: true,
      style:
        normalizedSearch.length > 0
          ? {
              ...(node.style ?? {}),
              opacity: matchesSearch ? 1 : 0.22,
            }
          : node.style,
      sourcePosition: (() => {
        const direction = sourceDirection.get(node.id);
        if (!direction || direction.count === 0) return Position.Bottom;
        return positionFromDelta(direction.dx / direction.count, direction.dy / direction.count);
      })(),
      targetPosition: (() => {
        const direction = targetDirection.get(node.id);
        if (!direction || direction.count === 0) return Position.Top;
        return positionFromDelta(direction.dx / direction.count, direction.dy / direction.count);
      })(),
      };
    });
  }, [edges, nodes]);

  const renderedEdges = useMemo(() => {
    return edges.map((edge) => {
      const rawLabel = typeof edge.label === 'string' ? edge.label : undefined;
      const label = rawLabel === 'assigned' ? undefined : rawLabel;
      const normalized = createSkillsGraphEdge(edge.source, edge.target, label, edge.id);
      return {
        ...normalized,
        ...edge,
        label: label ?? undefined,
        style: {
          ...(normalized.style ?? {}),
          ...(edge.style ?? {}),
        },
        labelStyle: {
          ...(normalized.labelStyle ?? {}),
          ...(edge.labelStyle ?? {}),
        },
        labelBgStyle: {
          ...(normalized.labelBgStyle ?? {}),
          ...(edge.labelBgStyle ?? {}),
        },
      };
    });
  }, [edges]);

  const skillNodeCount = useMemo(
    () => nodes.filter((node) => node.id.startsWith('skill-')).length,
    [nodes]
  );

  const availableUnassignedSkills = useMemo(() => {
    const assignedNodeIds = new Set(nodes.map((node) => node.id));
    const optionsByImplementationKey = new Map<string, AvailableSkillOption>();
    const settingsByImplementationKey = new Map(
      (toolSettings as GraphToolSetting[]).map((setting) => [setting.implementation_key, setting])
    );

    for (const setting of toolSettings as GraphToolSetting[]) {
      if (setting.enabled || setting.is_mandatory) continue;
      if (assignedNodeIds.has(toSkillNodeId(setting.implementation_key))) continue;
      optionsByImplementationKey.set(setting.implementation_key, {
        ability_name: setting.ability_name,
        implementation_key: setting.implementation_key,
        category: setting.category || 'automation',
        enabled: false,
        is_mandatory: false,
      });
    }

    for (const installed of installedSkills) {
      const implementationKey = installed.implementationKey;
      if (!implementationKey) continue;
      if (assignedNodeIds.has(toSkillNodeId(implementationKey))) continue;

      const matchingSetting = settingsByImplementationKey.get(implementationKey);
      if (matchingSetting?.enabled || matchingSetting?.is_mandatory) continue;

      optionsByImplementationKey.set(implementationKey, {
        ability_name: matchingSetting?.ability_name || installed.name,
        implementation_key: implementationKey,
        category: matchingSetting?.category || 'automation',
        enabled: false,
        is_mandatory: false,
      });
    }

    return Array.from(optionsByImplementationKey.values()).sort((a, b) =>
      a.ability_name.localeCompare(b.ability_name)
    );
  }, [installedSkills, nodes, toolSettings]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edgeId = `edge-${connection.source}-${connection.target}-${Date.now()}`;
      const created = createSkillsGraphEdge(
        connection.source,
        connection.target,
        defaultEdgeLabel,
        edgeId
      );
      setEdges((prev) => [
        ...prev,
        {
          ...created,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
        },
      ]);
    },
    [defaultEdgeLabel, setEdges]
  );

  const addSkillNodeFromSetting = (setting: AvailableSkillOption) => {
    const skillNodeId = toSkillNodeId(setting.implementation_key);
    const rootNodeId = `agent-${agentId}`;
    setNodes((prev) => {
      if (prev.some((node) => node.id === skillNodeId)) return prev;
      return [
        ...prev,
        {
          id: skillNodeId,
          type: 'skillsGraphNode',
          position: { x: 180 + prev.length * 24, y: 180 + prev.length * 24 },
          data: {
            label: setting.ability_name,
            level: 'intermediate',
            kind: 'skill',
            category: setting.category,
          },
        },
      ];
    });
    setEdges((prev) => {
      if (prev.some((edge) => edge.source === rootNodeId && edge.target === skillNodeId)) return prev;
      return [
        ...prev,
        createSkillsGraphEdge(
          rootNodeId,
          skillNodeId,
          undefined,
          `assigned-edge-${rootNodeId}-${skillNodeId}`
        ),
      ];
    });
    toast.success(`Added ${setting.ability_name}`);
  };

  const autoLayout = () => {
    setNodes((prev) => layoutGraph(prev, edges));
    toast.success('Applied dagre auto-layout');
  };

  const saveGraph = async () => {
    const rootNodeId = `agent-${agentId}`;
    const skillNodeIds = new Set(nodes.filter((node) => node.id.startsWith('skill-')).map((node) => node.id));
    const desiredAssignedImplementationKeys = Array.from(
      new Set(
        edges
          .filter((edge) => edge.source === rootNodeId && skillNodeIds.has(edge.target))
          .map((edge) => edge.target.replace(/^skill-/, ''))
      )
    );

    const settingsByImplementation = new Map(
      (toolSettings as GraphToolSetting[]).map((setting) => [setting.implementation_key, setting])
    );
    const installedByImplementation = new Map(
      installedSkills.map((installed) => [installed.implementationKey, installed])
    );
    const assignedRegistryImplementations = new Set(
      agentRegistrySkills.filter((skill) => skill.enabled).map((skill) => skill.implementationKey)
    );

    let registryAssignedCount = 0;
    let abilityEnabledCount = 0;
    const syncWarnings: string[] = [];

    try {
      for (const implementationKey of desiredAssignedImplementationKeys) {
        const setting = settingsByImplementation.get(implementationKey);
        const installed = installedByImplementation.get(implementationKey);
        const isRegistryManaged =
          setting?.source === 'registry-managed' || (!!installed && setting?.source !== 'core');

        if (isRegistryManaged && installed?.skillId) {
          if (!assignedRegistryImplementations.has(implementationKey)) {
            await assignRegistrySkill.mutateAsync({ skillId: installed.skillId, enabled: true });
            registryAssignedCount += 1;
          }
          continue;
        }

        if (setting && !setting.enabled) {
          await setAgentAbilityEnabled.mutateAsync({ implementationKey, enabled: true });
          abilityEnabledCount += 1;
          continue;
        }

        if (!setting && !installed) {
          syncWarnings.push(implementationKey);
        }
      }

      await saveMutation.mutateAsync({
        nodes: nodes as Array<Record<string, unknown>>,
        edges: edges as Array<Record<string, unknown>>,
        viewport: initialViewport,
      });

      if (registryAssignedCount > 0 || abilityEnabledCount > 0) {
        toast.success(
          `Graph saved - synced ${registryAssignedCount + abilityEnabledCount} skill assignment(s)`
        );
      } else {
        toast.success('Graph snapshot saved');
      }
      if (syncWarnings.length > 0) {
        toast.message(`Skipped ${syncWarnings.length} unknown skill node(s) during backend sync`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save graph');
    }
  };

  const suggestConnections = async () => {
    try {
      const suggestions = await suggestMutation.mutateAsync({
        nodes: nodes as Array<Record<string, unknown>>,
        edges: edges as Array<Record<string, unknown>>,
        viewport: initialViewport,
      });
      if (suggestions.proposedEdges.length === 0) {
        toast.message('No new suggestions right now');
        return;
      }
      setPendingSuggestedEdges(suggestions.proposedEdges);
      toast.success(`Review ${suggestions.proposedEdges.length} suggested connection(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to suggest connections');
    }
  };

  const applySuggestedEdge = (index: number) => {
    const next = pendingSuggestedEdges[index];
    if (!next) return;
    setEdges((prev) => [
      ...prev,
      createSkillsGraphEdge(
        next.source,
        next.target,
        next.label,
        `suggested-${next.source}-${next.target}-${Date.now()}-${index}`
      ),
    ]);
    setPendingSuggestedEdges((prev) => prev.filter((_, idx) => idx !== index));
  };

  const applyAllSuggestedEdges = () => {
    if (pendingSuggestedEdges.length === 0) return;
    setEdges((prev) => [
      ...prev,
      ...pendingSuggestedEdges.map((edge, index) =>
        createSkillsGraphEdge(
          edge.source,
          edge.target,
          edge.label,
          `suggested-${edge.source}-${edge.target}-${Date.now()}-${index}`
        )
      ),
    ]);
    setPendingSuggestedEdges([]);
    toast.success('Applied all suggested edges');
  };

  const submitSearch = () => {
    const term = searchInput.trim().toLowerCase();
    setActiveSearchTerm(term);
    if (!term) {
      toast.message('Search cleared');
      return;
    }
    const matchCount = nodes.filter((node) =>
      String(node.data?.label ?? '').toLowerCase().includes(term)
    ).length;
    if (matchCount === 0) {
      toast.message('No matching skills found');
      return;
    }
    toast.success(`Found ${matchCount} matching node${matchCount === 1 ? '' : 's'}`);
  };

  return (
    <div className="h-full min-h-0 overflow-hidden p-4">
      <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/70 bg-slate-950 shadow-[0_14px_50px_rgba(2,6,23,0.55)]">
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          colorMode="dark"
          className="bg-slate-950"
          defaultEdgeOptions={DEFAULT_SKILLS_GRAPH_EDGE_OPTIONS}
          nodesDraggable
          panOnDrag={false}
          selectionOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
        >
          <Panel position="top-left" className="m-3 flex gap-2">
            <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/80 px-3 backdrop-blur">
              <Avatar size="sm">
                {agentAvatar ? <AvatarImage src={agentAvatar} alt={agentName} /> : null}
                <AvatarFallback>{toInitials(agentName) || <Bot className="h-3.5 w-3.5" />}</AvatarFallback>
              </Avatar>
              <div className="flex flex-row items-center">
                <div className="font-sm leading-tight mr-2">{agentName}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{skillNodeCount} skills</div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div>
                  <ActionIconButton
                    label="Add skill"
                    onClick={() => undefined}
                    icon={<Plus className="h-4 w-4" />}
                  />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 min-w-[240px] overflow-y-auto border-border/70 bg-card/95 backdrop-blur"
              >
                <DropdownMenuLabel>Unassigned skills</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableUnassignedSkills.length === 0 ? (
                  <DropdownMenuItem disabled>No unassigned skills</DropdownMenuItem>
                ) : (
                  availableUnassignedSkills.map((setting) => (
                    <DropdownMenuItem
                      key={setting.implementation_key}
                      onSelect={() => addSkillNodeFromSetting(setting)}
                    >
                      {setting.ability_name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {isSearchOpen ? (
              <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-card/80 px-2 py-1 backdrop-blur">
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submitSearch();
                    }
                  }}
                  placeholder="Search skill nodes"
                  className="h-8 w-44 border-0 bg-transparent px-0 focus-visible:ring-0"
                />
                <ActionIconButton
                  label="Run search"
                  onClick={submitSearch}
                  icon={<Search className="h-4 w-4" />}
                />
                <ActionIconButton
                  label="Close search"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchInput('');
                    setActiveSearchTerm('');
                  }}
                  icon={<X className="h-4 w-4" />}
                />
              </div>
            ) : (
              <ActionIconButton
                label="Search graph"
                onClick={() => setIsSearchOpen(true)}
                icon={<Search className="h-4 w-4" />}
              />
            )}
          </Panel>

          <Panel position="top-right" className="m-3 flex gap-2">
            <div className="flex items-center rounded-lg border border-border/70 bg-card/80 px-2 backdrop-blur">
              <span className="px-2 text-xs text-muted-foreground">Edge type</span>
              <Select
                value={defaultEdgeLabel}
                onValueChange={(value) => setDefaultEdgeLabel(value as EdgeLabelType)}
              >
                <SelectTrigger className="h-8 w-[142px] border-0 bg-transparent focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDGE_LABEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ActionIconButton
              label="Auto layout"
              onClick={autoLayout}
              icon={<LayoutGrid className="h-4 w-4" />}
            />
            <ActionIconButton
              label="Suggest connections"
              onClick={() => void suggestConnections()}
              icon={<Sparkles className="h-4 w-4" />}
              disabled={suggestMutation.isPending}
            />
            <ActionIconButton
              label="Save graph"
              onClick={() => void saveGraph()}
              icon={<Save className="h-4 w-4" />}
              disabled={saveMutation.isPending}
            />
          </Panel>

          {pendingSuggestedEdges.length > 0 ? (
            <Panel position="bottom-right" className="m-3 w-[320px] rounded-lg border border-border/70 bg-card/90 p-3 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">Suggested edges</div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={applyAllSuggestedEdges}>
                    Apply all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingSuggestedEdges([])}>
                    Dismiss
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                {pendingSuggestedEdges.map((edge, index) => (
                  <div
                    key={`${edge.source}-${edge.target}-${index}`}
                    className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1 text-xs"
                  >
                    <span>
                      {edge.source} {'->'} {edge.target} ({edge.label ?? 'related'})
                    </span>
                    <Button size="sm" variant="outline" onClick={() => applySuggestedEdge(index)}>
                      Apply
                    </Button>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Controls className="!bg-slate-900/95 !border !border-slate-700/80 !shadow-lg" position="bottom-left" />
          <Background color="#334155" gap={24} size={1.2} />
        </ReactFlow>
      </div>
    </div>
  );
}
