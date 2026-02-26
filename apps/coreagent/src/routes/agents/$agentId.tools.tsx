import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  useAgentRegistrySkills,
  useAgentToolSettings,
  useSetAgentAbilityEnabled,
  useUpdateAgentAbilityConfig,
  type AgentToolSetting,
} from '@/hooks/useAbilities';
import {
  useAssignRegistrySkill,
  useInstallRegistrySkill,
  useInstalledSkills,
  useRegistrySkills,
  useRuntimeSyncDiagnostics,
  useUninstallRegistrySkill,
} from '@/hooks/useRegistrySkills';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '@/components/header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { TrustBadge } from '@/components/skills/trust-badge';

const categoryOrder = ['memory', 'perception', 'communication', 'automation', 'productivity'];
const AVAILABLE_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
const SOURCE_LABELS: Record<'core' | 'registry-managed' | 'orchestration-runtime' | 'custom', string> = {
  core: 'Core',
  'registry-managed': 'Registry',
  'orchestration-runtime': 'Orchestration',
  custom: 'Custom',
};

const LIFECYCLE_LABELS: Record<NonNullable<AgentToolSetting['lifecycle_state']>, string> = {
  discovered: 'Discovered',
  installed: 'Installed',
  assigned: 'Assigned',
  runtime_validated: 'Validated',
  active: 'Active',
  revoked: 'Revoked',
  force_disabled: 'Force Disabled',
  sync_stale: 'Sync Stale',
};

function toCategoryLabel(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function toToolSummary(setting: AgentToolSetting) {
  if (setting.description && setting.description.length > 0) return setting.description;
  return `Implementation key: ${setting.implementation_key}`;
}

function getEditableFields(setting: AgentToolSetting): Array<{
  key: string;
  label: string;
  type: 'string' | 'number';
}> {
  if (setting.implementation_key === 'vision_analysis' || setting.implementation_key === 'vision_screenshot') {
    return [];
  }
  if (setting.implementation_key === 'voice_synthesis') {
    return [{ key: 'default_voice', label: 'Default voice', type: 'string' }];
  }
  const schema = setting.parameters_schema;
  const properties =
    schema && typeof schema === 'object' && !Array.isArray(schema)
      ? (schema.properties as Record<string, { type?: string }> | undefined)
      : undefined;
  if (!properties) return [];
  return Object.entries(properties).map(([key, def]) => ({
    key,
    label: key.replace(/_/g, ' '),
    type: def?.type === 'number' || def?.type === 'integer' ? 'number' : 'string',
  }));
}

function isToolEditable(setting: AgentToolSetting) {
  return getEditableFields(setting).length > 0;
}

function resolveToolSource(setting: AgentToolSetting): keyof typeof SOURCE_LABELS {
  if (setting.source) {
    return setting.source;
  }
  return setting.is_mandatory ? 'core' : 'registry-managed';
}

function resolveLifecycleState(setting: AgentToolSetting): NonNullable<AgentToolSetting['lifecycle_state']> {
  if (setting.lifecycle_state) {
    return setting.lifecycle_state;
  }
  if (setting.is_mandatory) {
    return 'active';
  }
  return setting.enabled ? 'active' : 'assigned';
}

function resolveDisabledReason(setting: AgentToolSetting) {
  if (setting.enabled) {
    return null;
  }
  if (setting.disabled_reason && setting.disabled_reason.trim().length > 0) {
    return setting.disabled_reason;
  }
  if (setting.enforcement_state === 'force_disabled') {
    return 'Disabled by registry advisory or revocation.';
  }
  if (setting.enforcement_state === 'blocked_policy') {
    return 'Disabled by policy requirements.';
  }
  if (setting.enforcement_state === 'blocked_compatibility') {
    return 'Disabled due to app compatibility constraints.';
  }
  if (setting.enforcement_state === 'sync_stale') {
    return 'Disabled while skill sync is stale.';
  }
  if (setting.is_mandatory) {
    return 'Core tools remain enabled for runtime safety.';
  }
  return 'Disabled for this agent.';
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

function toRemediationMessage(error: unknown) {
  const message = toErrorMessage(error, 'Operation failed');
  const normalized = message.toLowerCase();
  if (normalized.includes('blocked while sync is degraded') || normalized.includes('hard-stale')) {
    return `${message} Run a runtime sync and retry.`;
  }
  if (normalized.includes('not installed')) {
    return `${message} Install the skill first, then retry assignment.`;
  }
  if (normalized.includes('agent not found')) {
    return `${message} Refresh the page and confirm the selected agent still exists.`;
  }
  return message;
}

export const Route = createFileRoute('/agents/$agentId/tools')({
  component: AgentToolsPage,
});

function AgentToolsPage() {
  const { agentId } = Route.useParams();
  const { data: settings = [], isLoading, error } = useAgentToolSettings(agentId);
  const { data: registrySkills = [] } = useAgentRegistrySkills(agentId);
  const { data: catalogSkills = [], isLoading: isCatalogLoading } = useRegistrySkills();
  const { data: installedSkills = [] } = useInstalledSkills();
  const { data: runtimeSyncDiagnostics } = useRuntimeSyncDiagnostics();
  const installRegistrySkill = useInstallRegistrySkill();
  const assignRegistrySkill = useAssignRegistrySkill(agentId);
  const uninstallRegistrySkill = useUninstallRegistrySkill(agentId);
  const setEnabled = useSetAgentAbilityEnabled(agentId);
  const updateConfig = useUpdateAgentAbilityConfig(agentId);
  const [editingTool, setEditingTool] = useState<AgentToolSetting | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const [hardRemoveTarget, setHardRemoveTarget] = useState<{ skillId: string; skillName: string } | null>(null);

  const mergedSettings = useMemo(() => {
    if (registrySkills.length === 0) {
      return settings;
    }
    const registryByImplementation = new Map(
      registrySkills.map((skill) => [skill.implementationKey, skill])
    );

    return settings.map((setting) => {
      if (setting.is_mandatory) {
        return { ...setting, source: setting.source ?? 'core' };
      }

      const registry = registryByImplementation.get(setting.implementation_key);
      if (!registry) {
        return {
          ...setting,
          source: setting.source ?? 'custom',
          lifecycle_state: setting.lifecycle_state ?? (setting.enabled ? 'active' : 'assigned'),
        };
      }

      const installState = registry.installState?.toLowerCase();
      const isInstalled = installState === 'installed';
      const lifecycleState: NonNullable<AgentToolSetting['lifecycle_state']> = !isInstalled
        ? 'force_disabled'
        : setting.enabled
          ? 'active'
          : 'assigned';

      const enforcementState: NonNullable<AgentToolSetting['enforcement_state']> | undefined =
        !isInstalled ? 'force_disabled' : setting.enabled ? 'active' : undefined;

      return {
        ...setting,
        source: 'registry-managed' as const,
        lifecycle_state: setting.lifecycle_state ?? lifecycleState,
        enforcement_state: setting.enforcement_state ?? enforcementState,
        disabled_reason:
          setting.disabled_reason ??
          (!isInstalled
            ? `Registry install state is '${registry.installState ?? 'unknown'}'.`
            : null),
      };
    });
  }, [registrySkills, settings]);

  const grouped = useMemo(() => {
    const byCategory: Record<string, AgentToolSetting[]> = {};
    for (const setting of mergedSettings) {
      if (!byCategory[setting.category]) byCategory[setting.category] = [];
      byCategory[setting.category].push(setting);
    }
    return byCategory;
  }, [mergedSettings]);

  const sortedCategories = useMemo(() => {
    const categories = Object.keys(grouped);
    return categories.sort((a, b) => {
      const ia = categoryOrder.indexOf(a);
      const ib = categoryOrder.indexOf(b);
      const aRank = ia === -1 ? 999 : ia;
      const bRank = ib === -1 ? 999 : ib;
      return aRank - bRank;
    });
  }, [grouped]);
  const enabledCount = mergedSettings.filter((tool) => tool.enabled).length;
  const sourceCounts = useMemo(() => {
    const counts: Record<keyof typeof SOURCE_LABELS, number> = {
      core: 0,
      'registry-managed': 0,
      'orchestration-runtime': 0,
      custom: 0,
    };
    for (const tool of mergedSettings) {
      counts[resolveToolSource(tool)] += 1;
    }
    return counts;
  }, [mergedSettings]);
  const toggleableTools = mergedSettings.filter((tool) => !tool.is_mandatory);
  const hasToggleableTools = toggleableTools.length > 0;
  const installedSkillIds = useMemo(
    () => new Set(installedSkills.map((skill) => skill.skillId)),
    [installedSkills]
  );
  const assignedSkillIds = useMemo(
    () => new Set(registrySkills.filter((skill) => skill.enabled).map((skill) => skill.skillId)),
    [registrySkills]
  );
  const forceDisabledCount = useMemo(
    () => mergedSettings.filter((tool) => tool.enforcement_state === 'force_disabled').length,
    [mergedSettings]
  );

  const setToolEnabled = async (setting: AgentToolSetting, enabled: boolean) => {
    try {
      await setEnabled.mutateAsync({
        implementationKey: setting.implementation_key,
        enabled,
      });
      toast.success(`${setting.ability_name} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (toggleError) {
      toast.error(`Failed to update ${setting.ability_name}`);
      console.error(toggleError);
    }
  };

  const setAllTools = async (enabled: boolean) => {
    const targets = toggleableTools.filter((tool) => tool.enabled !== enabled);
    if (targets.length === 0) {
      toast.message(enabled ? 'All tools already enabled' : 'All tools already disabled');
      return;
    }
    try {
      await Promise.all(
        targets.map((tool) =>
          setEnabled.mutateAsync({
            implementationKey: tool.implementation_key,
            enabled,
          })
        )
      );
      toast.success(enabled ? 'Enabled all tools' : 'Disabled all tools');
    } catch (bulkError) {
      toast.error('Failed to update all tools');
      console.error(bulkError);
    }
  };

  const openEditDialog = (setting: AgentToolSetting) => {
    const nextDrafts: Record<string, string> = {};
    for (const field of getEditableFields(setting)) {
      const value = setting.config?.[field.key];
      nextDrafts[field.key] = value === undefined || value === null ? '' : String(value);
    }
    setConfigDrafts(nextDrafts);
    setEditingTool(setting);
  };

  const closeDialog = () => {
    setEditingTool(null);
    setConfigDrafts({});
  };

  const saveDialogConfig = async () => {
    if (!editingTool) return;
    const fields = getEditableFields(editingTool);
    const nextConfig: Record<string, unknown> = { ...(editingTool.config ?? {}) };
    for (const field of fields) {
      const raw = (configDrafts[field.key] ?? '').trim();
      if (raw === '') {
        delete nextConfig[field.key];
      } else {
        nextConfig[field.key] = field.type === 'number' ? Number(raw) : raw;
      }
    }
    try {
      await updateConfig.mutateAsync({
        implementationKey: editingTool.implementation_key,
        config: nextConfig as Record<string, unknown>,
      });
      toast.success(`${editingTool.ability_name} settings saved`);
      closeDialog();
    } catch (configError) {
      toast.error('Failed to save tool configuration');
      console.error(configError);
    }
  };

  const installSkill = async (skillId: string) => {
    try {
      await installRegistrySkill.mutateAsync({ skillId });
      await assignRegistrySkill.mutateAsync({ skillId, enabled: true });
      toast.success('Skill installed and assigned to agent');
    } catch (installError) {
      toast.error(toRemediationMessage(installError));
      console.error(installError);
    }
  };

  const assignSkill = async (skillId: string) => {
    try {
      await assignRegistrySkill.mutateAsync({ skillId });
      toast.success('Skill assigned to agent');
    } catch (assignError) {
      toast.error(toRemediationMessage(assignError));
      console.error(assignError);
    }
  };

  const unassignSkill = async (skillId: string) => {
    try {
      await assignRegistrySkill.mutateAsync({ skillId, enabled: false });
      toast.success('Skill unassigned (soft-disabled) from agent');
    } catch (unassignError) {
      toast.error(toRemediationMessage(unassignError));
      console.error(unassignError);
    }
  };

  const hardRemoveSkill = async (skillId: string) => {
    try {
      await uninstallRegistrySkill.mutateAsync({ skillId });
      toast.success('Skill install removed from this user');
      setHardRemoveTarget(null);
    } catch (removeError) {
      toast.error(toRemediationMessage(removeError));
      console.error(removeError);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>

        {['Memory', 'Perception', 'Communication'].map((category) => (
          <section key={category} className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={`${category}-${index}`} className="px-0 py-4">
                  <CardHeader className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-5 w-10" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-16" />
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <Skeleton className="h-6 w-10 rounded-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>Agent Tools</CardTitle>
            <CardDescription>Failed to load tool settings for this agent.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <Header
        title="Tool Access"
        description={`${enabledCount}/${mergedSettings.length} tools enabled • ${sourceCounts.core} core • ${sourceCounts['registry-managed']} registry`}
      >
        {hasToggleableTools ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={setEnabled.isPending}
              onClick={() => void setAllTools(true)}
            >
              Enable all
            </Button>
            <Button
              variant="outline"
              disabled={setEnabled.isPending}
              onClick={() => void setAllTools(false)}
            >
              Deselect all
            </Button>
          </div>
        ) : null}
      </Header>

      {sortedCategories.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {toCategoryLabel(category)}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {grouped[category]
              .slice()
              .sort((a, b) => a.ability_name.localeCompare(b.ability_name))
              .map((setting) => {
                const editable = isToolEditable(setting);
                const source = resolveToolSource(setting);
                const lifecycle = resolveLifecycleState(setting);
                const disabledReason = resolveDisabledReason(setting);
                return (
                  <Card key={setting.ability_id} className="px-0 py-4">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{setting.ability_name}</CardTitle>
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Badge variant={source === 'core' ? 'secondary' : 'outline'}>
                            {SOURCE_LABELS[source]}
                          </Badge>
                          <Badge variant={lifecycle === 'active' ? 'secondary' : 'outline'}>
                            {LIFECYCLE_LABELS[lifecycle]}
                          </Badge>
                        </div>
                      </div>
                      <CardDescription className="line-clamp-2">{toToolSummary(setting)}</CardDescription>
                      {disabledReason ? (
                        <p className="text-xs text-muted-foreground mt-1">{disabledReason}</p>
                      ) : null}
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-2">
                      <Label htmlFor={`tool-toggle-${setting.ability_id}`} className="text-sm">
                        {setting.enabled ? 'Enabled' : 'Disabled'}
                      </Label>
                      <div className="flex items-center gap-2">
                        {editable ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={updateConfig.isPending}
                            onClick={() => openEditDialog(setting)}
                            aria-label={`Edit ${setting.ability_name} settings`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Switch
                          id={`tool-toggle-${setting.ability_id}`}
                          checked={setting.enabled}
                          disabled={setting.is_mandatory || setEnabled.isPending}
                          onCheckedChange={(next) => void setToolEnabled(setting, next)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Registry Diagnostics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="px-0 py-4">
            <CardHeader>
              <CardTitle className="text-base">Connectivity</CardTitle>
              <CardDescription>
                {runtimeSyncDiagnostics?.freshness === 'hard_stale'
                  ? 'Registry sync is hard-stale'
                  : runtimeSyncDiagnostics?.freshness === 'soft_stale'
                    ? 'Registry sync is degraded'
                    : 'Registry sync looks healthy'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="px-0 py-4">
            <CardHeader>
              <CardTitle className="text-base">Last Sync</CardTitle>
              <CardDescription>
                {runtimeSyncDiagnostics?.lastSuccessAtMs
                  ? new Date(runtimeSyncDiagnostics.lastSuccessAtMs).toLocaleString()
                  : 'No successful sync yet'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="px-0 py-4">
            <CardHeader>
              <CardTitle className="text-base">Force-Disabled Tools</CardTitle>
              <CardDescription>{forceDisabledCount} currently blocked</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Registry Skills
        </h2>
        {isCatalogLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={`registry-skeleton-${index}`} className="px-0 py-4">
                <CardHeader className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-9 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : catalogSkills.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {catalogSkills.map((skill) => {
              const isInstalled = installedSkillIds.has(skill.skillId);
              const isAssigned = assignedSkillIds.has(skill.skillId);
              const actionPending =
                installRegistrySkill.isPending || assignRegistrySkill.isPending || uninstallRegistrySkill.isPending;
              return (
                <Card key={skill.skillId} className="px-0 py-4">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{skill.name}</CardTitle>
                      <div className="flex gap-1">
                        <Badge variant="outline" className="capitalize">
                          {skill.risk}
                        </Badge>
                        <TrustBadge trusted={skill.trusted} />
                      </div>
                    </div>
                    <CardDescription className="line-clamp-3">{skill.description}</CardDescription>
                    <p className="text-xs text-muted-foreground">Latest: {skill.latestVersion}</p>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-2">
                    {isAssigned ? (
                      <Badge variant="secondary">Assigned</Badge>
                    ) : isInstalled ? (
                      <Badge variant="outline">Installed</Badge>
                    ) : (
                      <Badge variant="outline">Not installed</Badge>
                    )}
                    {!isInstalled ? (
                      <Button
                        size="sm"
                        disabled={actionPending}
                        onClick={() => void installSkill(skill.skillId)}
                      >
                        Install & Assign
                      </Button>
                    ) : !isAssigned ? (
                      <Button
                        size="sm"
                        disabled={actionPending}
                        onClick={() => void assignSkill(skill.skillId)}
                      >
                        Assign
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionPending}
                          onClick={() => void unassignSkill(skill.skillId)}
                        >
                          Unassign
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={actionPending}
                          onClick={() =>
                            setHardRemoveTarget({
                              skillId: skill.skillId,
                              skillName: skill.name,
                            })
                          }
                        >
                          Hard Remove
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No Registry Skills Available</CardTitle>
              <CardDescription>
                Publish starter markdown skills to the registry, then install and assign them here.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </section>

      {mergedSettings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Agent Tools Yet</CardTitle>
            <CardDescription>
              Use the Registry Skills section above to install and assign skills to this agent.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Dialog open={!!editingTool} onOpenChange={(open) => (!open ? closeDialog() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTool?.ability_name} Settings</DialogTitle>
            <DialogDescription>
              Update tool-specific settings, then save or cancel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {editingTool ? (
              getEditableFields(editingTool).map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label className="pb-2" htmlFor={`cfg-${field.key}`}>{field.label}</Label>
                  {editingTool.implementation_key === 'voice_synthesis' && field.key === 'default_voice' ? (
                    <Select
                      value={configDrafts[field.key] || 'alloy'}
                      onValueChange={(value) =>
                        setConfigDrafts((prev) => ({ ...prev, [field.key]: value }))
                      }
                    >
                      <SelectTrigger className="w-full capitalize" id={`cfg-${field.key}`}>
                        <SelectValue placeholder="Select a voice" />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABLE_VOICES.map((voice) => (
                          <SelectItem className="capitalize" key={voice} value={voice}>
                            {voice}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`cfg-${field.key}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={configDrafts[field.key] ?? ''}
                      onChange={(event) =>
                        setConfigDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    />
                  )}
                </div>
              ))
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={() => void saveDialogConfig()} disabled={updateConfig.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={hardRemoveTarget !== null}
        onOpenChange={(open) => (!open ? setHardRemoveTarget(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hard remove installed skill?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the skill install for your user account. Use this only for cleanup or security actions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!hardRemoveTarget) return;
                void hardRemoveSkill(hardRemoveTarget.skillId);
              }}
            >
              Remove {hardRemoveTarget?.skillName ?? 'skill'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
