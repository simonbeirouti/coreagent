import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  useAgentToolSettings,
  useSetAgentAbilityEnabled,
  useUpdateAgentAbilityConfig,
  type AgentToolSetting,
} from '@/hooks/useAbilities';
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
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

const categoryOrder = ['memory', 'perception', 'communication', 'automation', 'productivity'];
const AVAILABLE_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

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

export const Route = createFileRoute('/agents/$agentId/tools')({
  component: AgentToolsPage,
});

function AgentToolsPage() {
  const { agentId } = Route.useParams();
  const { data: settings = [], isLoading, error } = useAgentToolSettings(agentId);
  const setEnabled = useSetAgentAbilityEnabled(agentId);
  const updateConfig = useUpdateAgentAbilityConfig(agentId);
  const [editingTool, setEditingTool] = useState<AgentToolSetting | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});

  const grouped = useMemo(() => {
    const byCategory: Record<string, AgentToolSetting[]> = {};
    for (const setting of settings) {
      if (!byCategory[setting.category]) byCategory[setting.category] = [];
      byCategory[setting.category].push(setting);
    }
    return byCategory;
  }, [settings]);

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
  const enabledCount = settings.filter((tool) => tool.enabled).length;
  const toggleableTools = settings.filter((tool) => !tool.is_mandatory);
  const hasToggleableTools = toggleableTools.length > 0;

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
      <Header title="Tool Access" description={`${enabledCount}/${settings.length} tools enabled`}>
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
                return (
                  <Card key={setting.ability_id} className="px-0 py-4">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{setting.ability_name}</CardTitle>
                        {setting.is_mandatory ? <Badge variant="secondary">Core</Badge> : null}
                      </div>
                      <CardDescription className="line-clamp-2">{toToolSummary(setting)}</CardDescription>
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
    </div>
  );
}
