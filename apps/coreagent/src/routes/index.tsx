import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, PauseCircle, PlayCircle, TerminalSquare, Trash2 } from 'lucide-react';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/use-auth';
import { useAgents } from '@/hooks/useAgents';
import type { Agent } from '@/types';
import {
  OrchestrationMemory,
  OrchestrationRun,
  OrchestrationTask,
  useAgentDelegations,
  useCreateAgentDelegation,
  useCreateOrchestrationRun,
} from '@/hooks/useOrchestration';
import { type RuntimeRunConsoleEvent, useRuntimeRunConsole } from '@/hooks/useRuntimeRunConsole';
import { useRuntimeSyncDiagnostics } from '@/hooks/useRegistrySkills';
import { orchestrationKeys } from '@/lib/query-keys';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

type BoardLaneId = 'idle' | 'working' | 'review';

type BoardLaneMeta = {
  id: BoardLaneId;
  title: string;
  description: string;
};

const BOARD_LANES: BoardLaneMeta[] = [
  { id: 'idle', title: 'Idle Queue', description: 'Agents waiting for assignment' },
  { id: 'working', title: 'Working Now', description: 'Agents actively executing tasks' },
  { id: 'review', title: 'Ready For Review', description: 'Agents waiting for review or handoff' },
];

type BoardState = Record<BoardLaneId, string[]>;
type PersistedLaneMap = Record<string, BoardLaneId>;

const INITIAL_BOARD: BoardState = {
  idle: [],
  working: [],
  review: [],
};

const BOARD_LANE_STORAGE_KEY = 'coreagent.orchestration.board-lanes.v2';

type StepId = 0 | 1 | 2 | 3 | 4 | 5;

type WizardState = {
  parentAgentId: string;
  runTitle: string;
  runObjective: string;
  runPriority: 'low' | 'normal' | 'high';
  initialRunStatus: 'queued' | 'planned' | 'in_progress';
  childAgentId: string;
  delegationRole: 'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom';
  delegationScope: 'delegated' | 'shared' | 'observer';
  taskTitle: string;
  taskDescription: string;
  taskOwnerAgentId: string;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: string;
  memoryScope: 'private' | 'shared_run' | 'parent_visible';
  memoryKey: string;
  memorySummary: string;
};

type TaskCandidate = {
  id: string;
  runId: string;
  runTitle: string;
  title: string;
  status: OrchestrationTask['status'];
  updatedAt: string;
};

const FLOW_STEPS: Array<{ id: StepId; title: string; description: string }> = [
  {
    id: 0,
    title: 'Select Agent',
    description: 'Choose the parent agent that will own this orchestration run.',
  },
  {
    id: 1,
    title: 'Define Run',
    description: 'Set run objective, priority, and initial status before any task assignment.',
  },
  {
    id: 2,
    title: 'Sub-Agent Setup',
    description: 'Optionally prepare a sub-agent delegation for this run.',
  },
  {
    id: 3,
    title: 'Task Assignment',
    description: 'Define the first task and explicitly pick which agent will execute it.',
  },
  {
    id: 4,
    title: 'Updates And Memory',
    description: 'Configure scheduled updates and optional memory seed for the run.',
  },
  {
    id: 5,
    title: 'Review And Create',
    description: 'Verify everything and create run, task, and memory in one atomic flow.',
  },
];

function buildInitialState(defaultAgentId = ''): WizardState {
  return {
    parentAgentId: defaultAgentId,
    runTitle: '',
    runObjective: '',
    runPriority: 'normal',
    initialRunStatus: 'planned',
    childAgentId: '',
    delegationRole: 'researcher',
    delegationScope: 'delegated',
    taskTitle: '',
    taskDescription: '',
    taskOwnerAgentId: defaultAgentId,
    scheduleEnabled: true,
    scheduleIntervalMinutes: '15',
    memoryScope: 'shared_run',
    memoryKey: 'run-summary',
    memorySummary: '',
  };
}

function inferLaneFromAgent(_agent: Agent): BoardLaneId {
  // New agents should start idle until explicitly assigned or moved.
  return 'idle';
}

function isBoardLaneId(value: unknown): value is BoardLaneId {
  return value === 'idle' || value === 'working' || value === 'review';
}

function toRuntimeRunStatus(value?: string | null): 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' {
  if (!value) return 'running';
  if (value === 'succeeded') return 'succeeded';
  if (value === 'failed') return 'failed';
  if (value === 'timed_out') return 'timed_out';
  if (value === 'cancelled') return 'cancelled';
  return 'running';
}

function toRuntimeRunLabel(raw: string): string {
  const value = raw.trim();
  if (!value) return 'runtime-tool';
  const segment = value.split('.').pop() || value;
  return segment.replace(/[_-]+/g, ' ');
}

const AGENT_TERMINAL_COLOR_CLASSES = [
  'text-emerald-300',
  'text-cyan-300',
  'text-amber-300',
  'text-violet-300',
  'text-pink-300',
  'text-lime-300',
  'text-sky-300',
];

function agentColorClass(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_TERMINAL_COLOR_CLASSES[hash % AGENT_TERMINAL_COLOR_CLASSES.length];
}

function readPersistedLaneMap(): PersistedLaneMap {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(BOARD_LANE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: PersistedLaneMap = {};

    for (const [agentId, lane] of Object.entries(parsed)) {
      if (isBoardLaneId(lane)) {
        next[agentId] = lane;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function toPersistedLaneMap(board: BoardState): PersistedLaneMap {
  const laneMap: PersistedLaneMap = {};
  for (const lane of BOARD_LANES) {
    for (const id of board[lane.id]) {
      laneMap[id] = lane.id;
    }
  }
  return laneMap;
}

function writePersistedLaneMap(board: BoardState): void {
  if (typeof window === 'undefined') return;

  try {
    const laneMap = toPersistedLaneMap(board);
    window.localStorage.setItem(BOARD_LANE_STORAGE_KEY, JSON.stringify(laneMap));
  } catch {
    // Ignore persistence failures and keep in-memory board behavior.
  }
}

function findLaneForId(board: BoardState, id: string): BoardLaneId | undefined {
  if (BOARD_LANES.some((lane) => lane.id === id)) {
    return id as BoardLaneId;
  }
  return BOARD_LANES.find((lane) => board[lane.id].includes(id))?.id;
}

function laneVariant(laneId: BoardLaneId): 'outline' | 'default' | 'secondary' {
  if (laneId === 'working') return 'default';
  if (laneId === 'review') return 'secondary';
  return 'outline';
}

function moveAgentToLane(previous: BoardState, agentId: string, targetLane: BoardLaneId): BoardState {
  const next: BoardState = {
    idle: previous.idle.filter((id) => id !== agentId),
    working: previous.working.filter((id) => id !== agentId),
    review: previous.review.filter((id) => id !== agentId),
  };
  next[targetLane].unshift(agentId);
  return next;
}

function applyDragMove(previous: BoardState, activeId: string, overId: string): BoardState {
  const activeLane = findLaneForId(previous, activeId);
  const overLane = findLaneForId(previous, overId);
  if (!activeLane || !overLane) {
    return previous;
  }

  if (activeLane === overLane) {
    const oldIndex = previous[activeLane].indexOf(activeId);
    const newIndex = previous[overLane].indexOf(overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
      return previous;
    }
    return {
      ...previous,
      [activeLane]: arrayMove(previous[activeLane], oldIndex, newIndex),
    };
  }

  const activeItems = [...previous[activeLane]];
  const overItems = [...previous[overLane]];

  const oldIndex = activeItems.indexOf(activeId);
  if (oldIndex < 0) return previous;

  activeItems.splice(oldIndex, 1);

  const isDroppingOnLane = BOARD_LANES.some((lane) => lane.id === overId);
  const overIndex = overItems.indexOf(overId);
  const newIndex = isDroppingOnLane || overIndex < 0 ? overItems.length : overIndex;

  overItems.splice(newIndex, 0, activeId);

  return {
    ...previous,
    [activeLane]: activeItems,
    [overLane]: overItems,
  };
}

type AgentCardProps = {
  agent: Agent;
  laneId: BoardLaneId;
};

function AgentCard({ agent, laneId }: AgentCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: agent.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'rounded-md border bg-background p-3 shadow-sm',
        'cursor-grab active:cursor-grabbing',
        isDragging ? 'opacity-70 ring-2 ring-primary/40' : '',
      ].join(' ')}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{agent.name}</p>
        <Badge variant={laneVariant(laneId)}>{laneId}</Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{agent.persona}</p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{agent.provider_type}</span>
        <span className="font-mono">{agent.model_id}</span>
      </div>
    </div>
  );
}

type LaneColumnProps = {
  lane: BoardLaneMeta;
  agentsInLane: Agent[];
};

function LaneColumn({ lane, agentsInLane }: LaneColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });

  return (
    <div ref={setNodeRef} className="flex flex-col rounded-lg border overflow-auto bg-muted/20 p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{lane.title}</p>
          <p className="text-xs text-muted-foreground">{lane.description}</p>
        </div>
        <Badge variant="outline">{agentsInLane.length}</Badge>
      </div>

      <SortableContext items={agentsInLane.map((agent) => agent.id)} strategy={verticalListSortingStrategy}>
        <div className={["flex flex-1 flex-col gap-2", isOver ? 'rounded-md bg-primary/5 p-1' : ''].join(' ')}>
          {agentsInLane.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
              Drop agent here
            </div>
          ) : (
            agentsInLane.map((agent) => <AgentCard key={agent.id} agent={agent} laneId={lane.id} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: agents = [], isLoading: isAgentsLoading } = useAgents(user?.id || '');
  const persistedLaneMap = useMemo(() => readPersistedLaneMap(), []);

  const [board, setBoard] = useState<BoardState>(INITIAL_BOARD);
  const [activeDragAgentId, setActiveDragAgentId] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<StepId>(0);
  const [wizardState, setWizardState] = useState<WizardState>(() => buildInitialState(''));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idleToWorkingDialogOpen, setIdleToWorkingDialogOpen] = useState(false);
  const [idleToWorkingContext, setIdleToWorkingContext] = useState<{
    agentId: string;
    agentName: string;
  } | null>(null);
  const [idleToWorkingTasks, setIdleToWorkingTasks] = useState<TaskCandidate[]>([]);
  const [isLoadingIdleToWorkingTasks, setIsLoadingIdleToWorkingTasks] = useState(false);
  const [runtimeSelectedAgentIds, setRuntimeSelectedAgentIds] = useState<string[]>([]);
  const [runtimeAutoScroll, setRuntimeAutoScroll] = useState(true);
  const [runtimeConsoleExpanded, setRuntimeConsoleExpanded] = useState(false);
  const runtimeConsoleBottomRef = useRef<HTMLDivElement | null>(null);
  const { events: runtimeConsoleEvents, clearEvents: clearRuntimeConsoleEvents } = useRuntimeRunConsole();
  const { data: runtimeSyncDiagnostics } = useRuntimeSyncDiagnostics();

  const createRun = useCreateOrchestrationRun(wizardState.parentAgentId);
  const createDelegation = useCreateAgentDelegation(wizardState.parentAgentId);
  const { data: existingDelegations = [] } = useAgentDelegations(wizardState.parentAgentId);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (agents.length === 0) {
      setBoard(INITIAL_BOARD);
      return;
    }

    setBoard((previous) => {
      const ids = new Set(agents.map((agent) => agent.id));
      const next: BoardState = {
        idle: previous.idle.filter((id) => ids.has(id)),
        working: previous.working.filter((id) => ids.has(id)),
        review: previous.review.filter((id) => ids.has(id)),
      };

      const known = new Set([...next.idle, ...next.working, ...next.review]);
      for (const agent of agents) {
        if (!known.has(agent.id)) {
          const persistedLane = persistedLaneMap[agent.id];
          next[persistedLane ?? inferLaneFromAgent(agent)].push(agent.id);
        }
      }

      return next;
    });
  }, [agents, persistedLaneMap]);

  useEffect(() => {
    if (agents.length === 0) return;
    writePersistedLaneMap(board);
  }, [agents.length, board]);

  const agentById = useMemo(() => {
    return new Map(agents.map((agent) => [agent.id, agent]));
  }, [agents]);

  const activeDelegatedIds = useMemo(
    () =>
      existingDelegations
        .filter((delegation) => delegation.is_active)
        .map((delegation) => delegation.child_agent_id),
    [existingDelegations]
  );

  const candidateChildAgentId = wizardState.childAgentId.trim();

  const taskOwnerOptions = useMemo(() => {
    const all = [wizardState.parentAgentId, ...activeDelegatedIds];
    if (candidateChildAgentId && candidateChildAgentId !== wizardState.parentAgentId) {
      all.push(candidateChildAgentId);
    }
    return Array.from(new Set(all.filter(Boolean)));
  }, [activeDelegatedIds, candidateChildAgentId, wizardState.parentAgentId]);

  useEffect(() => {
    if (!wizardState.parentAgentId && agents.length > 0) {
      setWizardState((prev) => ({
        ...prev,
        parentAgentId: agents[0].id,
        taskOwnerAgentId: agents[0].id,
      }));
      return;
    }

    if (
      wizardState.taskOwnerAgentId &&
      taskOwnerOptions.length > 0 &&
      !taskOwnerOptions.includes(wizardState.taskOwnerAgentId)
    ) {
      setWizardState((prev) => ({
        ...prev,
        taskOwnerAgentId: taskOwnerOptions[0],
      }));
    }
  }, [agents, taskOwnerOptions, wizardState.parentAgentId, wizardState.taskOwnerAgentId]);

  const selectedParentAgent = useMemo(
    () => agents.find((agent) => agent.id === wizardState.parentAgentId),
    [agents, wizardState.parentAgentId]
  );

  const setField = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setWizardState((prev) => ({ ...prev, [key]: value }));
  };

  const launchWizardForAgent = (agentId: string) => {
    const next = buildInitialState(agentId);
    setWizardState(next);
    setActiveStep(1);
    setWizardOpen(true);
  };

  const loadOpenTasksForAgent = async (agentId: string): Promise<TaskCandidate[]> => {
    const runs = await invoke<OrchestrationRun[]>('list_orchestration_runs', { parentAgentId: agentId });
    if (runs.length === 0) {
      return [];
    }

    const taskBatches = await Promise.all(
      runs.map(async (run) => {
        const tasks = await invoke<OrchestrationTask[]>('list_orchestration_tasks', { runId: run.id });
        return tasks
          .filter(
            (task) =>
              task.owner_agent_id === agentId &&
              (task.status === 'queued' || task.status === 'planned' || task.status === 'waiting')
          )
          .map((task) => ({
            id: task.id,
            runId: run.id,
            runTitle: run.title,
            title: task.title,
            status: task.status,
            updatedAt: task.updated_at,
          }));
      })
    );

    return taskBatches
      .flat()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  };

  const openIdleToWorkingDialog = (agentId: string) => {
    const agentName = agentById.get(agentId)?.name ?? 'Agent';
    setIdleToWorkingContext({ agentId, agentName });
    setIdleToWorkingTasks([]);
    setIdleToWorkingDialogOpen(true);
    setIsLoadingIdleToWorkingTasks(true);

    void loadOpenTasksForAgent(agentId)
      .then((tasks) => setIdleToWorkingTasks(tasks))
      .catch(() => {
        setIdleToWorkingTasks([]);
        toast.error('Could not load available tasks for this agent.');
      })
      .finally(() => setIsLoadingIdleToWorkingTasks(false));
  };

  const validateStep = (step: StepId): string | null => {
    switch (step) {
      case 0:
        return wizardState.parentAgentId ? null : 'Select a parent agent first.';
      case 1:
        if (!wizardState.runTitle.trim()) return 'Run title is required.';
        if (!wizardState.runObjective.trim()) return 'Run objective is required.';
        return null;
      case 2:
        if (candidateChildAgentId && candidateChildAgentId === wizardState.parentAgentId) {
          return 'Child agent must be different from parent agent.';
        }
        return null;
      case 3: {
        if (!wizardState.taskTitle.trim()) return 'Task title is required.';
        if (!wizardState.taskOwnerAgentId) return 'Task owner is required.';
        if (wizardState.taskOwnerAgentId !== wizardState.parentAgentId) {
          const ownerAlreadyDelegated = activeDelegatedIds.includes(wizardState.taskOwnerAgentId);
          const ownerWillBeDelegated = candidateChildAgentId === wizardState.taskOwnerAgentId;
          if (!ownerAlreadyDelegated && !ownerWillBeDelegated) {
            return 'Task owner must already be delegated or provided as the child agent in Step 3.';
          }
        }
        return null;
      }
      case 4: {
        if (wizardState.scheduleEnabled) {
          const interval = Number(wizardState.scheduleIntervalMinutes);
          if (!Number.isFinite(interval) || interval < 1 || interval > 1440) {
            return 'Schedule interval must be between 1 and 1440 minutes.';
          }
        }
        if (wizardState.memorySummary.trim() && !wizardState.memoryKey.trim()) {
          return 'Memory key is required when memory summary is provided.';
        }
        return null;
      }
      case 5:
        return null;
      default:
        return null;
    }
  };

  const handleNext = () => {
    const error = validateStep(activeStep);
    if (error) {
      toast.error(error);
      return;
    }
    setActiveStep((prev) => (Math.min(prev + 1, FLOW_STEPS.length - 1) as StepId));
  };

  const handleBack = () => {
    setActiveStep((prev) => (Math.max(prev - 1, 0) as StepId));
  };

  const resetWizard = () => {
    const firstAgentId = agents[0]?.id ?? '';
    setWizardState(buildInitialState(firstAgentId));
    setActiveStep(0);
  };

  const createAssignment = async () => {
    const stepErrors = FLOW_STEPS
      .map((step) => ({ step: step.id, error: validateStep(step.id) }))
      .filter((item) => Boolean(item.error));

    if (stepErrors.length > 0) {
      const first = stepErrors[0];
      setActiveStep(first.step);
      toast.error(first.error || 'Please complete required fields before creating assignment.');
      return;
    }

    if (!user?.id) {
      toast.error('You must be authenticated to create orchestration assignments.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (candidateChildAgentId && candidateChildAgentId !== wizardState.parentAgentId) {
        const alreadyDelegated = activeDelegatedIds.includes(candidateChildAgentId);
        if (!alreadyDelegated) {
          await createDelegation.mutateAsync({
            parent_agent_id: wizardState.parentAgentId,
            child_agent_id: candidateChildAgentId,
            role: wizardState.delegationRole,
            ownership_scope: wizardState.delegationScope,
            created_by_user_id: user.id,
          });
        }
      }

      const createdRun = await createRun.mutateAsync({
        parent_agent_id: wizardState.parentAgentId,
        owner_user_id: user.id,
        title: wizardState.runTitle.trim(),
        objective: wizardState.runObjective.trim(),
        priority: wizardState.runPriority,
      });

      if (wizardState.initialRunStatus !== 'queued') {
        await invoke('update_orchestration_run_status', {
          runId: createdRun.id,
          status: wizardState.initialRunStatus,
          lastError: null,
        });
      }

      const createdTask = await invoke<OrchestrationTask>('create_orchestration_task', {
        request: {
          run_id: createdRun.id,
          owner_agent_id: wizardState.taskOwnerAgentId,
          title: wizardState.taskTitle.trim(),
          description: wizardState.taskDescription.trim() || null,
        },
      });

      if (wizardState.scheduleEnabled) {
        await invoke('set_orchestration_schedule', {
          runId: createdRun.id,
          enabled: true,
          intervalMinutes: Math.max(1, Number(wizardState.scheduleIntervalMinutes) || 15),
        });
      }

      if (wizardState.memorySummary.trim()) {
        await invoke<OrchestrationMemory>('upsert_orchestration_memory', {
          request: {
            run_id: createdRun.id,
            task_id: createdTask.id,
            agent_id: wizardState.taskOwnerAgentId,
            scope: wizardState.memoryScope,
            key: wizardState.memoryKey.trim(),
            summary: wizardState.memorySummary.trim(),
            payload: {
              source: 'assignment_wizard',
              run_id: createdRun.id,
              task_id: createdTask.id,
              summary: wizardState.memorySummary.trim(),
            },
          },
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orchestrationKeys.delegations(wizardState.parentAgentId) }),
        queryClient.invalidateQueries({ queryKey: orchestrationKeys.runs(wizardState.parentAgentId) }),
        queryClient.invalidateQueries({ queryKey: orchestrationKeys.tasks(createdRun.id) }),
        queryClient.invalidateQueries({ queryKey: orchestrationKeys.diagnostics(createdRun.id) }),
      ]);

      setBoard((previous) => {
        return moveAgentToLane(previous, wizardState.taskOwnerAgentId, 'working');
      });

      toast.success('Orchestration assignment created successfully.');
      setWizardOpen(false);
      resetWizard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create orchestration assignment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragAgentId(null);

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;

    const activeLane = findLaneForId(board, activeId);
    const overLane = findLaneForId(board, overId);
    if (!activeLane || !overLane) return;

    if (activeLane === 'idle' && overLane === 'review') {
      return;
    }

    if (activeLane === 'idle' && overLane === 'working') {
      openIdleToWorkingDialog(activeId);
      return;
    }

    setBoard((previous) => applyDragMove(previous, activeId, overId));
  };

  const stepProgress = ((activeStep + 1) / FLOW_STEPS.length) * 100;
  const activeDragAgent = activeDragAgentId ? agentById.get(activeDragAgentId) : undefined;
  const runtimeRunSummaries = useMemo(() => {
    const grouped = new Map<
      string,
      {
        clientRunId: string;
        implementationKey: string;
        runId?: string | null;
        status: 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
        startedAtMs: number;
        updatedAtMs: number;
        latestMessage: string;
        eventCount: number;
        agentId?: string;
      }
    >();

    for (const event of runtimeConsoleEvents) {
      const existing = grouped.get(event.clientRunId);
      const status = toRuntimeRunStatus(event.status);
      if (!existing) {
        grouped.set(event.clientRunId, {
          clientRunId: event.clientRunId,
          implementationKey: event.implementationKey,
          runId: event.runId ?? null,
          status,
          startedAtMs: event.timestampMs,
          updatedAtMs: event.timestampMs,
          latestMessage: event.message,
          eventCount: 1,
          agentId: event.agentId,
        });
        continue;
      }

      existing.updatedAtMs = Math.max(existing.updatedAtMs, event.timestampMs);
      existing.status = status;
      existing.latestMessage = event.message;
      existing.eventCount += 1;
      if (event.runId) existing.runId = event.runId;
      if (event.agentId) existing.agentId = event.agentId;
    }

    return Array.from(grouped.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [runtimeConsoleEvents]);
  const runtimeAgentOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const agent of agents) {
      byId.set(agent.id, agent.name);
    }
    for (const event of runtimeConsoleEvents) {
      if (!event.agentId) continue;
      const name = agentById.get(event.agentId)?.name ?? event.agentId;
      byId.set(event.agentId, name);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [runtimeConsoleEvents, agentById, agents]);
  const selectedAgentSet = useMemo(() => new Set(runtimeSelectedAgentIds), [runtimeSelectedAgentIds]);
  const runtimeFilteredEvents = useMemo(() => {
    if (selectedAgentSet.size === 0) return runtimeConsoleEvents;
    return runtimeConsoleEvents.filter((event) => {
      if (!event.agentId) return false;
      return selectedAgentSet.has(event.agentId);
    });
  }, [runtimeConsoleEvents, selectedAgentSet]);
  const runtimeFilteredRunSummaries = useMemo(() => {
    if (selectedAgentSet.size === 0) return runtimeRunSummaries;
    return runtimeRunSummaries.filter((run) => run.agentId && selectedAgentSet.has(run.agentId));
  }, [runtimeRunSummaries, selectedAgentSet]);
  const runtimeStats = useMemo(() => {
    return runtimeFilteredRunSummaries.reduce(
      (acc, run) => {
        if (run.status === 'running') acc.running += 1;
        if (run.status === 'succeeded') acc.succeeded += 1;
        if (run.status === 'failed' || run.status === 'timed_out' || run.status === 'cancelled') acc.failed += 1;
        return acc;
      },
      { running: 0, succeeded: 0, failed: 0 }
    );
  }, [runtimeFilteredRunSummaries]);

  const runtimeSyncFreshnessLabel = useMemo(() => {
    if (!runtimeSyncDiagnostics) return 'sync unknown';
    if (runtimeSyncDiagnostics.freshness === 'fresh') return 'sync fresh';
    if (runtimeSyncDiagnostics.freshness === 'soft_stale') return 'sync degraded';
    if (runtimeSyncDiagnostics.freshness === 'hard_stale') return 'sync hard-stale';
    return `sync ${runtimeSyncDiagnostics.freshness}`;
  }, [runtimeSyncDiagnostics]);

  const runtimeSyncLastSuccessLabel = useMemo(() => {
    if (!runtimeSyncDiagnostics?.lastSuccessAtMs) return 'last sync n/a';
    return `last sync ${new Date(runtimeSyncDiagnostics.lastSuccessAtMs).toLocaleTimeString()}`;
  }, [runtimeSyncDiagnostics]);

  useEffect(() => {
    if (!runtimeAutoScroll || !runtimeConsoleExpanded) return;
    runtimeConsoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runtimeAutoScroll, runtimeFilteredEvents, runtimeConsoleExpanded]);

  return (
    <div className="space-y-6 px-4">
      <Header
        title="Orchestration Board"
        description="Visualize agents by lane and create structured orchestration assignments from one flow."
      >
        <Button
          onClick={() => {
            if (!wizardState.parentAgentId && agents.length > 0) {
              setWizardState(buildInitialState(agents[0].id));
            }
            setWizardOpen(true);
          }}
          disabled={!user || isAgentsLoading || agents.length === 0}
        >
          <PlayCircle className="mr-2 h-4 w-4" />
          Create Job Assignment
        </Button>
      </Header>

      <div className="flex h-[calc(100vh-9.4rem)] min-h-0 flex-col gap-4">
        <div className="min-h-0 flex-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToWindowEdges]}
            onDragStart={(event) => setActiveDragAgentId(String(event.active.id))}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDragAgentId(null)}
          >
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-3 overflow-y-auto">
              {BOARD_LANES.map((lane) => {
                const agentsInLane = board[lane.id]
                  .map((id) => agentById.get(id))
                  .filter((agent): agent is Agent => Boolean(agent));

                return <LaneColumn key={lane.id} lane={lane} agentsInLane={agentsInLane} />;
              })}
            </div>

            <DragOverlay>
              {activeDragAgent ? (
                <div className="w-64 rounded-md border bg-background p-3 shadow-lg">
                  <p className="text-sm font-medium">{activeDragAgent.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{activeDragAgent.persona}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        <section
          className={`w-full overflow-hidden rounded-md border bg-background transition-[height] duration-200 ${
            runtimeConsoleExpanded ? 'h-[42%] min-h-[240px]' : 'h-12'
          }`}
        >
          <div
            className="flex h-12 cursor-pointer items-center justify-between border-b px-4"
            role="button"
            tabIndex={0}
            onClick={() => setRuntimeConsoleExpanded((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setRuntimeConsoleExpanded((value) => !value);
              }
            }}
          >
            <div className="flex items-center gap-2">
              {runtimeConsoleExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
              <TerminalSquare className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Runtime Console</p>
              <Badge variant="outline">{runtimeFilteredRunSummaries.length} runs</Badge>
              <Badge variant="default">{runtimeStats.running} running</Badge>
              <Badge variant="secondary">{runtimeStats.succeeded} succeeded</Badge>
              <Badge variant="destructive">{runtimeStats.failed} failed</Badge>
              <Badge
                variant={
                  runtimeSyncDiagnostics?.freshness === 'hard_stale'
                    ? 'destructive'
                    : runtimeSyncDiagnostics?.freshness === 'soft_stale'
                      ? 'secondary'
                      : 'outline'
                }
              >
                {runtimeSyncFreshnessLabel}
              </Badge>
              <Badge variant="outline">{runtimeSyncLastSuccessLabel}</Badge>
            </div>

            {runtimeConsoleExpanded ? (
              <div
                className="flex items-center gap-2"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-60 justify-start truncate"
                      title="Filter runtime logs by agents"
                    >
                      {runtimeSelectedAgentIds.length > 0
                        ? `${runtimeSelectedAgentIds.length} agent${runtimeSelectedAgentIds.length > 1 ? 's' : ''}`
                        : 'All agents'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    {runtimeAgentOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">No agents available</div>
                    ) : (
                      runtimeAgentOptions.map((agent) => (
                        <DropdownMenuCheckboxItem
                          key={agent.id}
                          checked={runtimeSelectedAgentIds.includes(agent.id)}
                          onCheckedChange={(checked) => {
                            setRuntimeSelectedAgentIds((prev) => {
                              if (checked) {
                                return prev.includes(agent.id) ? prev : [...prev, agent.id];
                              }
                              return prev.filter((id) => id !== agent.id);
                            });
                          }}
                        >
                          {agent.name}
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRuntimeAutoScroll((value) => !value)}
                  title={runtimeAutoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
                  aria-label={runtimeAutoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
                >
                  {runtimeAutoScroll ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearRuntimeConsoleEvents();
                    setRuntimeSelectedAgentIds([]);
                  }}
                  title="Clear runtime console"
                  aria-label="Clear runtime console"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>

          {runtimeConsoleExpanded ? (
            <div className="flex h-[calc(100%-3rem)] min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="space-y-1 bg-neutral-950 p-3 font-mono text-xs text-neutral-100">
                    {runtimeFilteredEvents.length === 0 ? (
                      <p className="text-neutral-100">No runtime logs yet in this session.</p>
                    ) : (
                      runtimeFilteredEvents.map((event: RuntimeRunConsoleEvent) => (
                        <div key={event.id} className="break-words">
                          <span>[{new Date(event.timestampMs).toLocaleTimeString()}]</span>{' '}
                          {event.agentId ? (
                            <span className={agentColorClass(event.agentId)}>
                              [{agentById.get(event.agentId)?.name ?? event.agentId}]
                            </span>
                          ) : null}{' '}
                          <span>[{event.status ?? 'running'}]</span>{' '}
                          <span>[{toRuntimeRunLabel(event.implementationKey)}]</span>{' '}
                          <span>{event.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={runtimeConsoleBottomRef} />
                  </div>
                </ScrollArea>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <AlertDialog
        open={idleToWorkingDialogOpen}
        onOpenChange={(open) => {
          setIdleToWorkingDialogOpen(open);
          if (!open) {
            setIdleToWorkingContext(null);
            setIdleToWorkingTasks([]);
            setIsLoadingIdleToWorkingTasks(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move To Working</AlertDialogTitle>
            <AlertDialogDescription>
              {idleToWorkingContext?.agentName ?? 'Agent'} can move to working after selecting task context.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isLoadingIdleToWorkingTasks ? (
            <p className="text-sm text-muted-foreground">Loading available tasks...</p>
          ) : idleToWorkingTasks.length === 0 ? (
            <Alert>
              <AlertTitle>No queued tasks found</AlertTitle>
              <AlertDescription>
                Open the assignment wizard to create a run and task before moving this agent to working.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Available tasks</p>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                {idleToWorkingTasks.map((task) => (
                  <div key={task.id} className="rounded-md border p-2">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.runTitle} · {task.status}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Keep In Idle</AlertDialogCancel>
            {idleToWorkingTasks.length > 0 ? (
              <AlertDialogAction
                onClick={() => {
                  if (!idleToWorkingContext) return;
                  setBoard((previous) => moveAgentToLane(previous, idleToWorkingContext.agentId, 'working'));
                  toast.success('Agent moved to Working with queued task context.');
                  setIdleToWorkingDialogOpen(false);
                }}
              >
                Move To Working
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={() => {
                  if (!idleToWorkingContext) return;
                  setIdleToWorkingDialogOpen(false);
                  launchWizardForAgent(idleToWorkingContext.agentId);
                }}
              >
                Open Assignment Wizard
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) {
            resetWizard();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Create Orchestration Assignment</DialogTitle>
            <DialogDescription>
              Follow each step to ensure run context is complete before assigning work to an agent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Progress value={stepProgress} />
            <div className="flex flex-wrap gap-2">
              {FLOW_STEPS.map((step) => (
                <Badge key={step.id} variant={step.id === activeStep ? 'default' : 'outline'}>
                  {step.id + 1}. {step.title}
                </Badge>
              ))}
            </div>
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">{FLOW_STEPS[activeStep].title}</p>
              <p className="text-xs text-muted-foreground">{FLOW_STEPS[activeStep].description}</p>
            </div>
          </div>

          <Separator />

          {activeStep === 0 ? (
            <div className="space-y-2">
              <Label>Parent Agent</Label>
              <Select
                value={wizardState.parentAgentId}
                onValueChange={(value) => {
                  setField('parentAgentId', value);
                  setField('taskOwnerAgentId', value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedParentAgent ? (
                <p className="text-xs text-muted-foreground">
                  Provider: {selectedParentAgent.provider_type} | Model: {selectedParentAgent.model_id}
                </p>
              ) : null}
            </div>
          ) : null}

          {activeStep === 1 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Run Title</Label>
                <Input
                  value={wizardState.runTitle}
                  onChange={(event) => setField('runTitle', event.target.value)}
                  placeholder="Launch customer onboarding research"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Run Objective</Label>
                <Textarea
                  value={wizardState.runObjective}
                  onChange={(event) => setField('runObjective', event.target.value)}
                  placeholder="Collect references, draft structure, and prepare synthesis summary"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={wizardState.runPriority}
                  onValueChange={(value) => setField('runPriority', value as WizardState['runPriority'])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">low</SelectItem>
                    <SelectItem value="normal">normal</SelectItem>
                    <SelectItem value="high">high</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Initial Run Status</Label>
                <Select
                  value={wizardState.initialRunStatus}
                  onValueChange={(value) =>
                    setField('initialRunStatus', value as WizardState['initialRunStatus'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="queued">queued</SelectItem>
                    <SelectItem value="planned">planned</SelectItem>
                    <SelectItem value="in_progress">in_progress</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {activeStep === 2 ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Optional Child Agent ID</Label>
                <Input
                  value={wizardState.childAgentId}
                  onChange={(event) => setField('childAgentId', event.target.value)}
                  placeholder="Paste agent UUID only if delegating"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty if this run will stay with the parent agent only.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Delegation Role</Label>
                  <Select
                    value={wizardState.delegationRole}
                    onValueChange={(value) =>
                      setField('delegationRole', value as WizardState['delegationRole'])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planner">planner</SelectItem>
                      <SelectItem value="researcher">researcher</SelectItem>
                      <SelectItem value="executor">executor</SelectItem>
                      <SelectItem value="reviewer">reviewer</SelectItem>
                      <SelectItem value="custom">custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Ownership Scope</Label>
                  <Select
                    value={wizardState.delegationScope}
                    onValueChange={(value) =>
                      setField('delegationScope', value as WizardState['delegationScope'])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delegated">delegated</SelectItem>
                      <SelectItem value="shared">shared</SelectItem>
                      <SelectItem value="observer">observer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium">Existing Active Delegations</p>
                {activeDelegatedIds.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active child agents for this parent yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeDelegatedIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {id.slice(0, 8)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeStep === 3 ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input
                  value={wizardState.taskTitle}
                  onChange={(event) => setField('taskTitle', event.target.value)}
                  placeholder="Gather source references"
                />
              </div>
              <div className="space-y-2">
                <Label>Task Description</Label>
                <Textarea
                  value={wizardState.taskDescription}
                  onChange={(event) => setField('taskDescription', event.target.value)}
                  placeholder="Include architecture notes, schema deltas, and unresolved risks"
                />
              </div>
              <div className="space-y-2">
                <Label>Assign Task To</Label>
                <Select
                  value={wizardState.taskOwnerAgentId}
                  onValueChange={(value) => setField('taskOwnerAgentId', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Task owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {taskOwnerOptions.map((ownerId) => (
                      <SelectItem key={ownerId} value={ownerId}>
                        {ownerId === wizardState.parentAgentId
                          ? `Parent (${ownerId.slice(0, 8)})`
                          : ownerId.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {activeStep === 4 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Scheduled Updates</p>
                  <p className="text-xs text-muted-foreground">Enable periodic summary updates for this run</p>
                </div>
                <Switch
                  checked={wizardState.scheduleEnabled}
                  onCheckedChange={(value) => setField('scheduleEnabled', value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Schedule Interval (minutes)</Label>
                <Input
                  value={wizardState.scheduleIntervalMinutes}
                  onChange={(event) => setField('scheduleIntervalMinutes', event.target.value)}
                  disabled={!wizardState.scheduleEnabled}
                />
              </div>

              <Separator />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Memory Scope</Label>
                  <Select
                    value={wizardState.memoryScope}
                    onValueChange={(value) =>
                      setField('memoryScope', value as WizardState['memoryScope'])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">private</SelectItem>
                      <SelectItem value="shared_run">shared_run</SelectItem>
                      <SelectItem value="parent_visible">parent_visible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Memory Key</Label>
                  <Input
                    value={wizardState.memoryKey}
                    onChange={(event) => setField('memoryKey', event.target.value)}
                    placeholder="run-summary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Memory Summary (optional)</Label>
                <Textarea
                  value={wizardState.memorySummary}
                  onChange={(event) => setField('memorySummary', event.target.value)}
                  placeholder="Seed summary that should be available to this run"
                />
              </div>
            </div>
          ) : null}

          {activeStep === 5 ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-3">
                <p className="font-medium">Parent Agent</p>
                <p className="text-muted-foreground">{selectedParentAgent?.name ?? wizardState.parentAgentId}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Run</p>
                <p className="text-muted-foreground">{wizardState.runTitle}</p>
                <p className="text-muted-foreground">{wizardState.runObjective}</p>
                <p className="text-muted-foreground">
                  Priority: {wizardState.runPriority} | Initial status: {wizardState.initialRunStatus}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Delegation</p>
                <p className="text-muted-foreground">
                  {candidateChildAgentId
                    ? `${candidateChildAgentId} (${wizardState.delegationRole}, ${wizardState.delegationScope})`
                    : 'No new child delegation requested'}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Task</p>
                <p className="text-muted-foreground">{wizardState.taskTitle}</p>
                <p className="text-muted-foreground">Owner: {wizardState.taskOwnerAgentId}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Updates and Memory</p>
                <p className="text-muted-foreground">
                  Schedule: {wizardState.scheduleEnabled ? `every ${wizardState.scheduleIntervalMinutes}m` : 'disabled'}
                </p>
                <p className="text-muted-foreground">
                  Memory: {wizardState.memorySummary.trim() ? `yes (${wizardState.memoryScope})` : 'not set'}
                </p>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={handleBack} disabled={activeStep === 0 || isSubmitting}>
              Back
            </Button>
            {activeStep < FLOW_STEPS.length - 1 ? (
              <Button onClick={handleNext} disabled={isSubmitting}>
                Next
              </Button>
            ) : (
              <Button onClick={createAssignment} disabled={isSubmitting || createRun.isPending}>
                {isSubmitting ? 'Creating...' : 'Create Assignment'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
