import { useEffect, useMemo, useState } from 'react';
import {
  AssignmentReview,
  useAgentDelegations,
  useAutoAssignOrchestrationTask,
  useCreateAgentDelegation,
  useCreateOrchestrationRun,
  useCreateOrchestrationTask,
  useOrchestrationDiagnostics,
  useOrchestrationEvents,
  useOrchestrationMemories,
  useOrchestrationRuns,
  useOrchestrationTaskDetail,
  useOrchestrationTasks,
  useRevokeAgentDelegation,
  useReassignOrchestrationTask,
  useReviewOrchestrationTaskAssignment,
  useRetryOrchestrationTask,
  useSetOrchestrationSchedule,
  useSkipOrchestrationTask,
  useSubmitOrchestrationTaskFeedback,
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
import { REQUIREMENT_TEMPLATES, templateAbilityCsv } from '@/lib/orchestration-requirement-templates';

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
  const { data: runs = [], isLoading: isRunsLoading } = useOrchestrationRuns(agentId);
  const { data: delegations = [] } = useAgentDelegations(agentId);

  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [runTitle, setRunTitle] = useState('');
  const [runObjective, setRunObjective] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskRequirementTemplateId, setTaskRequirementTemplateId] = useState<string>('');
  const [taskRequiredAbilities, setTaskRequiredAbilities] = useState('');
  const [taskPreferredRole, setTaskPreferredRole] = useState<'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom'>('custom');
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
  const [feedbackNotes, setFeedbackNotes] = useState<Record<string, string>>({});
  const [assignmentReviews, setAssignmentReviews] = useState<Record<string, AssignmentReview>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  const createRun = useCreateOrchestrationRun(agentId);
  const createDelegation = useCreateAgentDelegation(agentId);
  const revokeDelegation = useRevokeAgentDelegation(agentId);
  const updateRunStatus = useUpdateOrchestrationRunStatus(agentId);
  const createTask = useCreateOrchestrationTask(selectedRunId);
  const retryTask = useRetryOrchestrationTask(selectedRunId);
  const skipTask = useSkipOrchestrationTask(selectedRunId);
  const submitTaskFeedback = useSubmitOrchestrationTaskFeedback(selectedRunId);
  const reassignTask = useReassignOrchestrationTask(selectedRunId);
  const reviewTaskAssignment = useReviewOrchestrationTaskAssignment(selectedRunId);
  const autoAssignTask = useAutoAssignOrchestrationTask(selectedRunId);
  const setSchedule = useSetOrchestrationSchedule(selectedRunId);
  const upsertMemory = useUpsertOrchestrationMemory(selectedRunId, agentId, 'all');
  const { data: diagnostics, isLoading: isDiagnosticsLoading } = useOrchestrationDiagnostics(selectedRunId, 10);
  const { data: runEvents = [] } = useOrchestrationEvents(selectedRunId, 120);
  const { data: tasks = [] } = useOrchestrationTasks(selectedRunId);
  const { data: selectedTaskDetail, isLoading: isTaskDetailLoading } = useOrchestrationTaskDetail(selectedTaskId);
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

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedTaskId('');
      return;
    }
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) {
      return;
    }
    setSelectedTaskId(tasks[0]?.id ?? '');
  }, [selectedRunId, selectedTaskId, tasks]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId), [runs, selectedRunId]);

  const submitRun = async () => {
    if (!runTitle.trim() || !runObjective.trim()) {
      toast.error('Run title and objective are required');
      return;
    }
    try {
      const created = await createRun.mutateAsync({
        parent_agent_id: agentId,
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
    const requiredAbilityKeys = taskRequiredAbilities
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    if (requiredAbilityKeys.length === 0) {
      toast.error('Task requires at least one required ability key for deterministic assignment');
      return;
    }
    try {
      await createTask.mutateAsync({
        run_id: selectedRunId,
        owner_agent_id: taskOwnerAgentId,
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
        required_ability_keys: requiredAbilityKeys,
        preferred_role: taskPreferredRole,
      });
      setTaskTitle('');
      setTaskDescription('');
      setTaskRequirementTemplateId('');
      setTaskRequiredAbilities('');
      setTaskPreferredRole('custom');
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

  const handleSkip = async (taskId: string) => {
    try {
      await skipTask.mutateAsync({
        taskId,
        requestedByAgentId: agentId,
        reason: 'task_skipped_from_dashboard',
      });
      toast.success('Task skipped');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed skipping task');
    }
  };

  const handleReviewAssignment = async (taskId: string) => {
    try {
      const review = await reviewTaskAssignment.mutateAsync({ taskId });
      setAssignmentReviews((previous) => ({ ...previous, [taskId]: review }));
      if (!review.recommended_agent_id) {
        toast.error('No eligible agent found for this task.');
        return;
      }
      toast.success(`Recommended ${review.recommended_agent_id.slice(0, 8)} (${Math.round(review.confidence * 100)}%)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed reviewing assignment');
    }
  };

  const handleAutoAssign = async (taskId: string) => {
    const review = assignmentReviews[taskId];
    try {
      await autoAssignTask.mutateAsync({
        taskId,
        requestedByAgentId: agentId,
        requiredAbilityKeys: review?.required_ability_keys,
        preferredRole: (review?.preferred_role as 'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom' | null) ?? undefined,
      });
      toast.success('Task auto-assigned to best suited agent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed auto-assigning task');
    }
  };

  const handleSubmitFeedback = async (taskId: string, verdict: 'approved' | 'rework' | 'rejected') => {
    try {
      await submitTaskFeedback.mutateAsync({
        taskId,
        verdict,
        notes: feedbackNotes[taskId]?.trim() || null,
        requestedByAgentId: agentId,
      });
      setFeedbackNotes((previous) => ({ ...previous, [taskId]: '' }));
      toast.success(`Task feedback submitted (${verdict})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed submitting task feedback');
    }
  };

  const handleRevokeDelegation = async (delegationId: string) => {
    try {
      await revokeDelegation.mutateAsync({
        delegationId,
      });
      toast.success('Delegation revoked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed revoking delegation');
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
        <Button onClick={submitRun} disabled={createRun.isPending}>
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
            <Button onClick={submitDelegation} disabled={createDelegation.isPending}>
              {createDelegation.isPending ? 'Adding...' : 'Add Sub-Agent'}
            </Button>
          </div>
          {delegations.length > 0 && (
            <div className="space-y-2">
              {delegations.map((delegation) => (
                <div key={delegation.id} className="flex items-center justify-between rounded-md border p-2">
                  <Badge variant={delegation.is_active ? 'secondary' : 'outline'}>
                    {delegation.role}: {delegation.child_agent_id.slice(0, 8)} ({delegation.ownership_scope})
                  </Badge>
                  {delegation.is_active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRevokeDelegation(delegation.id)}
                      disabled={revokeDelegation.isPending}
                    >
                      Revoke
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Inactive</span>
                  )}
                </div>
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
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              value={taskRequirementTemplateId || 'custom'}
              onValueChange={(value) => {
                if (value === 'custom') {
                  setTaskRequirementTemplateId('');
                  return;
                }
                const template = REQUIREMENT_TEMPLATES.find((item) => item.id === value);
                if (!template) return;
                setTaskRequirementTemplateId(template.id);
                setTaskRequiredAbilities(templateAbilityCsv(template.id));
                setTaskPreferredRole(template.preferredRole);
              }}
              disabled={!selectedRunId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Requirement template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                {REQUIREMENT_TEMPLATES.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Input
              value={taskRequiredAbilities}
              onChange={(event) => {
                setTaskRequirementTemplateId('');
                setTaskRequiredAbilities(event.target.value);
              }}
              placeholder="Required abilities (comma-separated)"
              disabled={!selectedRunId}
            />
            <Select
              value={taskPreferredRole}
              onValueChange={(value) =>
                {
                  setTaskRequirementTemplateId('');
                  setTaskPreferredRole(value as 'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom');
                }
              }
              disabled={!selectedRunId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Preferred role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">custom</SelectItem>
                <SelectItem value="planner">planner</SelectItem>
                <SelectItem value="researcher">researcher</SelectItem>
                <SelectItem value="executor">executor</SelectItem>
                <SelectItem value="reviewer">reviewer</SelectItem>
              </SelectContent>
            </Select>
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
                      {!['completed', 'cancelled'].includes(task.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleSkip(task.id)}
                          disabled={skipTask.isPending}
                        >
                          Skip
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        Inspect
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleReviewAssignment(task.id)}
                        disabled={reviewTaskAssignment.isPending}
                      >
                        Review Match
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => void handleAutoAssign(task.id)}
                        disabled={autoAssignTask.isPending || !assignmentReviews[task.id]?.recommended_agent_id}
                      >
                        Auto-Assign
                      </Button>
                    </div>
                    {assignmentReviews[task.id] ? (
                      <div className="mt-3 rounded-md border p-2 text-xs">
                        <p className="font-medium">
                          Recommendation:{" "}
                          {assignmentReviews[task.id]?.recommended_agent_id
                            ? assignmentReviews[task.id]!.recommended_agent_id!.slice(0, 8)
                            : 'none'}
                          {" · "}
                          confidence {Math.round((assignmentReviews[task.id]?.confidence ?? 0) * 100)}%
                        </p>
                        <p className="mt-1 text-muted-foreground">{assignmentReviews[task.id]?.rationale}</p>
                      </div>
                    ) : null}
                    {task.status === 'completed' && (
                      <div className="mt-3 space-y-2 rounded-md border p-2">
                        <Label className="text-xs">Feedback Notes (optional)</Label>
                        <Textarea
                          value={feedbackNotes[task.id] ?? ''}
                          onChange={(event) =>
                            setFeedbackNotes((previous) => ({ ...previous, [task.id]: event.target.value }))
                          }
                          placeholder="What should be improved or accepted?"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleSubmitFeedback(task.id, 'approved')}
                            disabled={submitTaskFeedback.isPending}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleSubmitFeedback(task.id, 'rework')}
                            disabled={submitTaskFeedback.isPending}
                          >
                            Rework
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleSubmitFeedback(task.id, 'rejected')}
                            disabled={submitTaskFeedback.isPending}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <Label>Run Event Timeline</Label>
          {runEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orchestration events for this run yet.</p>
          ) : (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
              {runEvents.slice(0, 40).map((event) => (
                <div key={event.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between">
                    <Badge variant={event.severity === 'error' ? 'destructive' : event.severity === 'warning' ? 'secondary' : 'outline'}>
                      {event.event_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <Label>Task Detail</Label>
          {!selectedTaskId ? (
            <p className="text-sm text-muted-foreground">Select a task with Inspect to view attempts, events, memories, and feedback history.</p>
          ) : isTaskDetailLoading ? (
            <p className="text-sm text-muted-foreground">Loading task detail...</p>
          ) : !selectedTaskDetail ? (
            <p className="text-sm text-muted-foreground">Task detail unavailable.</p>
          ) : (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{selectedTaskDetail.task.title}</p>
                <Badge variant={STATUS_COLOR[selectedTaskDetail.task.status] ?? 'outline'}>
                  {toLabel(selectedTaskDetail.task.status)}
                </Badge>
              </div>
              <div>
                <p className="text-xs font-medium">Attempts</p>
                <p className="text-xs text-muted-foreground">
                  {selectedTaskDetail.attempts.length === 0
                    ? 'No attempts recorded'
                    : selectedTaskDetail.attempts.map((attempt) => `#${attempt.attempt_number} ${attempt.status}`).join(' · ')}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium">Latest Events</p>
                {selectedTaskDetail.events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No task events</p>
                ) : (
                  <div className="space-y-1">
                    {selectedTaskDetail.events.slice(0, 4).map((event) => (
                      <p key={event.id} className="text-xs text-muted-foreground">
                        {event.event_type}
                        {event.event_type === 'task.assignment_reviewed' && typeof event.payload?.rationale === 'string'
                          ? ` · ${event.payload.rationale}`
                          : ''}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-medium">Feedback History</p>
                <p className="text-xs text-muted-foreground">
                  {selectedTaskDetail.feedback.length === 0
                    ? 'No feedback submitted'
                    : selectedTaskDetail.feedback.map((item) => item.verdict).join(' · ')}
                </p>
              </div>
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
