import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getDockerSkillPreflight,
  usePublishRegistrySkill,
  useStartDockerSkillPreflight,
  useUploadRegistrySkillArtifact,
} from '@/hooks/useSkillPublishing';
import { useInstallRegistrySkill } from '@/hooks/useRegistrySkills';
import { useAuth } from '@/hooks/use-auth';
import { useAgents } from '@/hooks/useAgents';

export const Route = createFileRoute('/skills/create')({
  component: SkillsCreatePage,
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === 'string' && maybe.message.trim().length > 0) {
      return maybe.message;
    }
  }
  return 'Unknown error';
}

function extractToolResponse(stdout: string): string {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('[preflight-'));
  if (lines.length === 0) {
    return '(no response payload emitted by script)';
  }
  const text = lines.join('\n');
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatPreflightTerminal(result: {
  status: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string {
  return [
    `[status] ${result.status}`,
    `[exitCode] ${result.exitCode ?? '(running)'}`,
    '[stdout]',
    result.stdout || '(empty)',
    '[stderr]',
    result.stderr || '(empty)',
  ].join('\n');
}

function SkillsCreatePage() {
  const { user } = useAuth();
  const { data: agents = [] } = useAgents(user?.id ?? '');
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [exampleFile, setExampleFile] = useState<File | null>(null);
  const [scriptDigest, setScriptDigest] = useState('');
  const [exampleDigest, setExampleDigest] = useState('');
  const [preflightRunId, setPreflightRunId] = useState<string | null>(null);
  const [preflightStatus, setPreflightStatus] = useState<'running' | 'passed' | 'failed' | null>(null);
  const [terminalOutput, setTerminalOutput] = useState('');
  const [toolResponseOutput, setToolResponseOutput] = useState('');
  const [assignAgentIds, setAssignAgentIds] = useState<string[]>([]);
  const [isPollingPreflight, setIsPollingPreflight] = useState(false);

  const uploadArtifact = useUploadRegistrySkillArtifact();
  const runPreflight = useStartDockerSkillPreflight();
  const publish = usePublishRegistrySkill();
  const installSkill = useInstallRegistrySkill();

  const skillId = useMemo(() => {
    const slug = slugifyTitle(title);
    return slug ? `coreagent.${slug}` : '';
  }, [title]);

  const canUpload = useMemo(() => {
    return (
      title.trim().length > 0 &&
      scriptFile !== null &&
      exampleFile !== null &&
      version.trim().length > 0 &&
      skillId.trim().length > 0
    );
  }, [exampleFile, scriptFile, skillId, title, version]);

  const canTest = useMemo(() => {
    return (
      title.trim().length > 0 &&
      scriptDigest.trim().length > 0 &&
      exampleDigest.trim().length > 0
    );
  }, [exampleDigest, scriptDigest, title]);

  const canPublish = useMemo(() => {
    return (
      canTest &&
      preflightRunId !== null &&
      preflightStatus === 'passed'
    );
  }, [canTest, preflightRunId, preflightStatus]);

  const currentStep = useMemo<'upload' | 'test' | 'publish'>(() => {
    if (canPublish) {
      return 'publish';
    }
    if (canTest) {
      return 'test';
    }
    return 'upload';
  }, [canPublish, canTest]);

  const resetPostUploadState = () => {
    setPreflightRunId(null);
    setPreflightStatus(null);
    setTerminalOutput('');
    setToolResponseOutput('');
    setAssignAgentIds([]);
  };

  const uploadFiles = async () => {
    if (!canUpload || !scriptFile || !exampleFile) {
      toast.error('Provide title, script and example file first.');
      return;
    }
    try {
      const [scriptBase64, exampleBase64] = await Promise.all([
        fileToBase64(scriptFile),
        fileToBase64(exampleFile),
      ]);

      let scriptUpload;
      try {
        scriptUpload = await uploadArtifact.mutateAsync({ artifactBase64: scriptBase64 });
      } catch (error) {
        console.error('Script upload failed:', error);
        toast.error(`Script upload failed: ${getErrorMessage(error)}`);
        return;
      }

      let exampleUpload;
      try {
        exampleUpload = await uploadArtifact.mutateAsync({ artifactBase64: exampleBase64 });
      } catch (error) {
        console.error('Example upload failed:', error);
        toast.error(`Example upload failed: ${getErrorMessage(error)}`);
        return;
      }

      setScriptDigest(scriptUpload.digest);
      setExampleDigest(exampleUpload.digest);
      resetPostUploadState();
      toast.success('Script and example uploaded.');
    } catch (error) {
      console.error('Upload preparation failed:', error);
      toast.error(`Upload failed: ${getErrorMessage(error)}`);
    }
  };

  const runDockerTest = async () => {
    try {
      if (!canTest) {
        toast.error('Upload script and example first.');
        return;
      }
      const result = await runPreflight.mutateAsync({
        title: title.trim(),
        skillId: skillId.trim(),
        scriptArtifactDigest: scriptDigest.trim(),
        exampleArtifactDigest: exampleDigest.trim(),
      });
      setPreflightRunId(result.runId);
      setPreflightStatus(result.status === 'running' ? 'running' : result.status === 'passed' ? 'passed' : 'failed');
      setIsPollingPreflight(true);
      setToolResponseOutput('');
      setTerminalOutput(formatPreflightTerminal(result));

      let latest = result;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (latest.status !== 'running') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        latest = await getDockerSkillPreflight(result.runId);
        setPreflightStatus(latest.status === 'running' ? 'running' : latest.status === 'passed' ? 'passed' : 'failed');
        setTerminalOutput(formatPreflightTerminal(latest));
        setToolResponseOutput(extractToolResponse(latest.stdout || ''));
      }

      if (latest.status === 'running') {
        setPreflightStatus('running');
        setIsPollingPreflight(false);
        toast.error('Docker preflight is still running. Please wait and retry.');
        return;
      }

      setIsPollingPreflight(false);
      if (latest.status === 'passed') {
        toast.success('Docker preflight passed. Publish is now enabled.');
      } else {
        toast.error('Docker preflight failed. See terminal output.');
      }
    } catch (error) {
      console.error('Docker preflight failed:', error);
      setIsPollingPreflight(false);
      setToolResponseOutput('');
      toast.error(`Docker preflight failed: ${getErrorMessage(error)}`);
    }
  };

  const runPublish = async () => {
    try {
      if (!canPublish) {
        toast.error('Publish is locked until Docker preflight succeeds.');
        return;
      }

      await installSkill.mutateAsync({
        skillId: skillId.trim(),
        version: version.trim(),
        autoUpdate: true,
      });

      if (assignAgentIds.length > 0) {
        await Promise.all(
          assignAgentIds.map((agentId) =>
            invoke('assign_registry_skill', {
              skillId: skillId.trim(),
              agentId,
              enabled: true,
              config: {},
            })
          )
        );
      }
      toast.success('Skill published.');
    } catch (error) {
      console.error('Publish failed:', error);
      toast.error(`Publish failed: ${getErrorMessage(error)}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col px-4 pb-4 space-y-4 overflow-auto lg:overflow-hidden">
      <Header title="Create Skill" description="Minimal flow: title + script + example file, then Docker preflight." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:flex-1 lg:min-h-0">
        <div className="col-span-1 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    resetPostUploadState();
                  }}
                  placeholder="Dayjs Timeline Skill"
                />
              </div>
              <div className="space-y-2">
                <Label>Script file</Label>
                <Input
                  type="file"
                  onChange={(e) => {
                    setScriptFile(e.target.files?.[0] ?? null);
                    setScriptDigest('');
                    resetPostUploadState();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Example input file</Label>
                <Input
                  type="file"
                  onChange={(e) => {
                    setExampleFile(e.target.files?.[0] ?? null);
                    setExampleDigest('');
                    resetPostUploadState();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Version</Label>
                <Input
                  value={version}
                  onChange={(e) => {
                    setVersion(e.target.value);
                    resetPostUploadState();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Derived Skill ID</Label>
                <Input value={skillId} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Tool response output</Label>
                <Textarea
                  value={toolResponseOutput}
                  readOnly
                  rows={4}
                  placeholder="Run Docker preflight to see the script response payload."
                />
              </div>
              {preflightStatus === 'passed' ? (
                <div className="space-y-2 rounded border p-2">
                  <Label>Optional: assign to agents after publish</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start truncate"
                        title="Select agents to assign after publish"
                      >
                        {assignAgentIds.length > 0
                          ? `${assignAgentIds.length} agent${assignAgentIds.length > 1 ? 's' : ''}`
                          : 'No agents selected'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-60">
                      {agents.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No agents available</div>
                      ) : (
                        agents.map((agent) => (
                          <DropdownMenuCheckboxItem
                            key={agent.id}
                            checked={assignAgentIds.includes(agent.id)}
                            onCheckedChange={(checked) => {
                              setAssignAgentIds((prev) =>
                                checked ? (prev.includes(agent.id) ? prev : [...prev, agent.id]) : prev.filter((id) => id !== agent.id)
                              );
                            }}
                          >
                            {agent.name}
                          </DropdownMenuCheckboxItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-muted-foreground">
                    Install after publish is automatic. Agent assignment is optional.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {currentStep === 'upload' ? (
                  <Button disabled={!canUpload || uploadArtifact.isPending} onClick={() => void uploadFiles()}>
                    {uploadArtifact.isPending ? 'Uploading...' : 'Upload script + example'}
                  </Button>
                ) : null}
                {currentStep === 'test' ? (
                  <Button disabled={!canTest || runPreflight.isPending || isPollingPreflight} onClick={() => void runDockerTest()}>
                    {runPreflight.isPending || isPollingPreflight ? 'Testing in Docker...' : 'Test in Docker'}
                  </Button>
                ) : null}
                {currentStep === 'publish' ? (
                  <Button disabled={!canPublish || publish.isPending} onClick={() => void runPublish()}>
                    {publish.isPending ? 'Publishing...' : 'Publish'}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="col-span-1 flex flex-col lg:col-span-2 lg:min-h-0">
          <CardHeader>
            <CardTitle>Docker Terminal Output</CardTitle>
            <CardDescription>Preflight stdout/stderr appears here. Publish unlocks only on success.</CardDescription>
          </CardHeader>
          <CardContent className="lg:flex-1 lg:min-h-0">
            <pre className="min-h-64 rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap lg:h-full lg:overflow-auto">
              {terminalOutput || 'No preflight run yet.'}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
