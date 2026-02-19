import { useEffect, useMemo, useState } from 'react';
import { useAgent } from '@/hooks/useAgents';
import {
  useAgentDelegations,
  useCreateAgentDelegation,
  useCreateOrchestrationRun,
  useCreateOrchestrationTask,
  useOrchestrationDiagnostics,
  useOrchestrationMemories,
  useOrchestrationRuns,
  useOrchestrationTasks,
  useReassignOrchestrationTask,
  useRetryOrchestrationTask,
  useSetOrchestrationSchedule,
  useUpdateOrchestrationRunStatus,
  useUpsertOrchestrationMemory,
} from '@/hooks/useOrchestration';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  planned: 'secondary',
  in_progress: 'default',
  waiting: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
  paused: 'secondary',
};

interface OrchestrationPanelProps {
  agentId: string;
}

function toLabel(value: string) {
  return value.replace(/_/g, ' ').trim();
}

export function OrchestrationPanel({ agentId }: OrchestrationPanelProps) {
  const { data: agent } = useAgent(agentId);
  const { data: runs = [], isLoading: isRunsLoading } = useOrchestrationRuns(agentId);
  const { data: delegations = [] } = useAgentDelegations(agentId);

  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [runTitle, setRunTitle] = useState('');
  const [runObjective, setRunObjective] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskOwnerAgentId, setTaskOwnerAgentId] = useState(agentId);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState('15');
  const [newChildAgentId, setNewChildAgentId] = useState('');
  const [delegationRole, setDelegationRole] = useState<'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom'>('researcher');
  const [delegationScope, setDelegationScope] = useState<'delegated' | 'shared' | 'observer'>('delegated');
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({});
  const [memoryScope, setMemoryScope] = useState<'private' | 'shared_run' | 'parent_visible'>('shared_run');
  const [memoryKey, setMemoryKey] = useState('run-summary');
  const [memorySummary, setMemorySummary] = useState('');

  const createRun = useCreateOrchestrationRun(agentId);
  const createDelegation = useCreateAgentDelegation(agentId);
  const updateRunStatus = useUpdateOrchestrationRunStatus(agentId);
  const createTask = useCreateOrchestrationTask(selectedRunId);
  const retryTask = useRetryOrchestrationTask(selectedRunId);
  const reassignTask = useReassignOrchestrationTask(selectedRunId);
  const setSchedule = useSetOrchestrationSchedule(selectedRunId);
  const upsertMemory = useUpsertOrchestrationMemory(selectedRunId, agentId, 'all');
  const { data: diagnostics, isLoading: isDiagnosticsLoading } = useOrchestrationDiagnostics(selectedRunId, 10);
  const { data: tasks = [] } = useOrchestrationTasks(selectedRunId);
  const { data: memories = [] } = useOrchestrationMemories(selectedRunId, agentId, 'all');

  const ownerOptions = useMemo(() => {
    const activeChildren = delegations.filter((value) => value.is_active).map((value) => value.child_agent_id);
    return Array.from(new Set([agentId, ...activeChildren]));
  }, [agentId, delegations]);

  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    setScheduleEnabled(Boolean(diagnostics?.schedule?.enabled));
    setScheduleInterval(String(diagnostics?.schedule?.interval_minutes ?? 15));
  }, [diagnostics?.schedule?.enabled, diagnostics?.schedule?.interval_minutes]);

  useEffect(() => {
    if (!ownerOptions.includes(taskOwnerAgentId)) {
      setTaskOwnerAgentId(ownerOptions[0] ?? agentId);
    }
  }, [agentId, ownerOptions, taskOwnerAgentId]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId), [runs, selectedRunId]);

  const submitRun = async () => {
    if (!agent?.user_id) {
      toast.error('Missing owner user context for run creation');
      return;
    }
    if (!runTitle.trim() || !runObjective.trim()) {
      toast.error('Run title and objective are required');
      return;
    }
    try {
      const created = await createRun.mutateAsync({
        parent_agent_id: agentId,
        owner_user_id: agent.user_id,
        title: runTitle.trim(),
        objective: runObjective.trim(),
        priority: 'normal',
      });
      setSelectedRunId(created.id);
      setRunTitle('');
      setRunObjective('');
      toast.success('Orchestration run created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed creating run');
    }
  };

  const submitDelegation = async () => {
    if (!agent?.user_id) {
      toast.error('Missing user context for delegation creation');
      return;
    }
    if (!newChildAgentId.trim()) {
      toast.error('Child agent id is required');
      return;
    }
    try {
      await createDelegation.mutateAsync({
        parent_agent_id: agentId,
        child_agent_id: newChildAgentId.trim(),
        role: delegationRole,
        ownership_scope: delegationScope,
        created_by_user_id: agent.user_id,
      });
      setNewChildAgentId('');
      toast.success('Sub-agent delegation added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed creating delegation');
    }
  };

  const submitTask = async () => {
    if (!selectedRunId) {
      toast.error('Select a run before adding tasks');
      return;
    }
    if (!taskTitle.trim()) {
      toast.error('Task title is required');
      return;
    }
    try {
      await createTask.mutateAsync({
        run_id: selectedRunId,
        owner_agent_id: taskOwnerAgentId,
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
      });
      setTaskTitle('');
      setTaskDescription('');
      toast.success('Task added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed adding task');
    }
  };

  const setStatus = async (status: 'planned' | 'in_progress' | 'paused' | 'cancelled') => {
    if (!selectedRunId) return;
    try {
      await updateRunStatus.mutateAsync({ runId: selectedRunId, status });
      toast.success(`Run set to ${status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed updating run status');
    }
  };

  const saveSchedule = async (enabled: boolean, intervalMinutes: number) => {
    if (!selectedRunId) return;
    try {
      await setSchedule.mutateAsync({ enabled, intervalMinutes });
      toast.success('Schedule updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed updating schedule');
    }
  };

  const saveMemory = async () => {
    if (!selectedRunId) {
      toast.error('Select a run before adding memory');
      return;
    }
    if (!memoryKey.trim()) {
      toast.error('Memory key is required');
      return;
    }
    try {
      await upsertMemory.mutateAsync({
        run_id: selectedRunId,
        agent_id: agentId,
        scope: memoryScope,
        key: memoryKey.trim(),
        summary: memorySummary.trim() || undefined,
        payload: {
          summary: memorySummary.trim(),
          run_id: selectedRunId,
          updated_at: new Date().toISOString(),
        },
      });
      setMemorySummary('');
      toast.success('Memory saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed saving memory');
    }
  };

  const handleReassign = async (taskId: string, currentOwnerAgentId: string) => {
    const nextOwner = reassignTargets[taskId] ?? currentOwnerAgentId;
    if (!nextOwner || nextOwner === currentOwnerAgentId) {
      toast.error('Choose a different owner to reassign');
      return;
    }
    try {
      await reassignTask.mutateAsync({
        taskId,
        newOwnerAgentId: nextOwner,
        requestedByAgentId: agentId,
        reason: 'manual_dashboard_reassign',
      });
      toast.success('Task owner updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed reassigning task');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestration</CardTitle>
        <CardDescription>Sub-agent delegation, run lifecycle, memory scopes, heartbeats, and schedule controls.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="run-title">New Run Title</Label>
            <Input
              id="run-title"
              value={runTitle}
              onChange={(event) => setRunTitle(event.target.value)}
              placeholder="Ship onboarding docs workflow"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="run-objective">Objective</Label>
            <Input
              id="run-objective"
              value={runObjective}
              onChange={(event) => setRunObjective(event.target.value)}
              placeholder="Produce validated docs package with diagnostics"
            />
          </div>
        </div>
        <Button onClick={submitRun} disabled={createRun.isPending || !agent?.user_id}>
          {createRun.isPending ? 'Creating...' : 'Create Run'}
        </Button>

        <Separator />

        <div className="space-y-3 rounded-md border p-3">
          <Label>Sub-Agent Delegation</Label>
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              value={newChildAgentId}
              onChange={(event) => setNewChildAgentId(event.target.value)}
              placeholder="Child agent UUID"
            />
            <Select value={delegationRole} onValueChange={(value) => setDelegationRole(value as typeof delegationRole)}>
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
            <Select value={delegationScope} onValueChange={(value) => setDelegationScope(value as typeof delegationScope)}>
              <SelectTrigger>
                <SelectValue placeholder="Ownership Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delegated">delegated</SelectItem>
                <SelectItem value="shared">shared</SelectItem>
                <SelectItem value="observer">observer</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={submitDelegation} disabled={createDelegation.isPending || !agent?.user_id}>
              {createDelegation.isPending ? 'Adding...' : 'Add Sub-Agent'}
            </Button>
          </div>
          {delegations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {delegations.map((delegation) => (
                <Badge key={delegation.id} variant={delegation.is_active ? 'secondary' : 'outline'}>
                  {delegation.role}: {delegation.child_agent_id.slice(0, 8)}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Select Run</Label>
            <Select value={selectedRunId} onValueChange={setSelectedRunId} disabled={isRunsLoading || runs.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={isRunsLoading ? 'Loading runs...' : 'Choose a run'} />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Run Status</Label>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_COLOR[selectedRun?.status ?? 'queued'] ?? 'outline'}>
                {selectedRun?.status ? toLabel(selectedRun.status) : 'n/a'}
              </Badge>
              {isDiagnosticsLoading && <span className="text-xs text-muted-foreground">Refreshing diagnostics...</span>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Latest Heartbeat</Label>
            <div className="text-sm text-muted-foreground">
              {diagnostics?.latest_heartbeat_at
                ? new Date(diagnostics.latest_heartbeat_at).toLocaleString()
                : 'No heartbeat yet'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setStatus('planned')} disabled={!selectedRunId || updateRunStatus.isPending}>
            Plan
          </Button>
          <Button variant="secondary" onClick={() => setStatus('in_progress')} disabled={!selectedRunId || updateRunStatus.isPending}>
            Start
          </Button>
          <Button variant="secondary" onClick={() => setStatus('paused')} disabled={!selectedRunId || updateRunStatus.isPending}>
            Pause
          </Button>
          <Button variant="destructive" onClick={() => setStatus('cancelled')} disabled={!selectedRunId || updateRunStatus.isPending}>
            Cancel
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Scheduled Updates</p>
              <p className="text-xs text-muted-foreground">Periodic run summaries</p>
            </div>
            <Switch
              checked={scheduleEnabled}
              onCheckedChange={(next) => {
                setScheduleEnabled(next);
                const intervalMinutes = Math.max(1, Number(scheduleInterval) || 15);
                void saveSchedule(next, intervalMinutes);
              }}
              disabled={!selectedRunId || setSchedule.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-interval">Interval (minutes)</Label>
            <Input
              id="schedule-interval"
              value={scheduleInterval}
              onChange={(event) => setScheduleInterval(event.target.value)}
              onBlur={() => {
                const intervalMinutes = Math.max(1, Number(scheduleInterval) || 15);
                setScheduleInterval(String(intervalMinutes));
                if (selectedRunId) {
                  void saveSchedule(scheduleEnabled, intervalMinutes);
                }
              }}
              disabled={!selectedRunId}
            />
          </div>

          <div className="space-y-2">
            <Label>Stale Tasks</Label>
            <div className="text-sm text-muted-foreground">
              {diagnostics?.stale_tasks?.length ?? 0}
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <Label>Create Task</Label>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Collect source references"
              disabled={!selectedRunId}
            />
            <Textarea
              value={taskDescription}
              onChange={(event) => setTaskDescription(event.target.value)}
              placeholder="Focus on architecture and schema notes"
              disabled={!selectedRunId}
            />
            <Select value={taskOwnerAgentId} onValueChange={setTaskOwnerAgentId} disabled={!selectedRunId}>
              <SelectTrigger>
                <SelectValue placeholder="Task owner" />
              </SelectTrigger>
              <SelectContent>
                {ownerOptions.map((ownerId) => (
                  <SelectItem key={ownerId} value={ownerId}>
                    {ownerId === agentId ? `Parent (${ownerId.slice(0, 8)})` : ownerId.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submitTask} disabled={!selectedRunId || createTask.isPending}>
            {createTask.isPending ? 'Adding Task...' : 'Add Task'}
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Task List</Label>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet for this run.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => {
                const selectedOwner = reassignTargets[task.id] ?? task.owner_agent_id;
                return (
                  <div key={task.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{task.title}</p>
                        {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
                        <p className="text-xs text-muted-foreground">Owner: {task.owner_agent_id.slice(0, 8)}</p>
                        {task.last_failure_reason && (
                          <p className="text-xs text-destructive">Failure: {task.last_failure_reason}</p>
                        )}
                      </div>
                      <Badge variant={STATUS_COLOR[task.status] ?? 'outline'}>{toLabel(task.status)}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Heartbeat: {Math.round((task.heartbeat_progress ?? 0) * 100)}%</span>
                      <span>
                        Attempts: {task.attempt_count}/{task.max_retries}
                        {task.next_retry_at ? `, next retry ${new Date(task.next_retry_at).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <Select
                        value={selectedOwner}
                        onValueChange={(value) =>
                          setReassignTargets((previous) => ({ ...previous, [task.id]: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Reassign owner" />
                        </SelectTrigger>
                        <SelectContent>
                          {ownerOptions.map((ownerId) => (
                            <SelectItem key={`${task.id}-${ownerId}`} value={ownerId}>
                              {ownerId === agentId ? `Parent (${ownerId.slice(0, 8)})` : ownerId.slice(0, 8)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleReassign(task.id, task.owner_agent_id)}
                        disabled={reassignTask.isPending || selectedOwner === task.owner_agent_id}
                      >
                        Reassign
                      </Button>
                      {task.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => retryTask.mutate({ taskId: task.id, requestedByAgentId: agentId })}
                          disabled={retryTask.isPending}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <Label>Run Memories</Label>
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={memoryScope} onValueChange={(value) => setMemoryScope(value as typeof memoryScope)}>
              <SelectTrigger>
                <SelectValue placeholder="Memory scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">private</SelectItem>
                <SelectItem value="shared_run">shared_run</SelectItem>
                <SelectItem value="parent_visible">parent_visible</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={memoryKey}
              onChange={(event) => setMemoryKey(event.target.value)}
              placeholder="Memory key"
              disabled={!selectedRunId}
            />
            <Button onClick={saveMemory} disabled={!selectedRunId || upsertMemory.isPending}>
              {upsertMemory.isPending ? 'Saving...' : 'Save Memory'}
            </Button>
          </div>
          <Textarea
            value={memorySummary}
            onChange={(event) => setMemorySummary(event.target.value)}
            placeholder="Short summary to promote across agents"
            disabled={!selectedRunId}
          />
          {memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No memory entries for this run yet.</p>
          ) : (
            <div className="space-y-2">
              {memories.slice(0, 6).map((memory) => (
                <div key={memory.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{memory.key}</p>
                    <Badge variant="outline">{memory.scope}</Badge>
                  </div>
                  {memory.summary && <p className="text-xs text-muted-foreground mt-1">{memory.summary}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
