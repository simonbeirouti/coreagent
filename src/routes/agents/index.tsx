import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from '@/hooks/use-auth';
import { useAgents, useUpdateAgent } from '@/hooks/useAgents';
import { Agent } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Bot, MessageSquare, Brain, Mic, Settings, BarChart3 } from 'lucide-react';
import { Header } from '@/components/header';

export const Route = createFileRoute('/agents/')({
  component: AgentsPage,
});

const statusUi: Record<Agent['state'], { label: string; triggerClass: string; dotClass: string }> = {
  active: {
    label: 'Active',
    triggerClass: 'border-green-500/40 text-green-700 dark:text-green-300',
    dotClass: 'bg-green-500',
  },
  paused: {
    label: 'Paused',
    triggerClass: 'border-yellow-500/40 text-yellow-700 dark:text-yellow-300',
    dotClass: 'bg-yellow-500',
  },
  stopped: {
    label: 'Stopped',
    triggerClass: 'border-red-500/40 text-red-700 dark:text-red-300',
    dotClass: 'bg-red-500',
  },
};

function AgentsPage() {
  const { user } = useAuth();
  const { data: agents, isLoading, error } = useAgents(user?.id || '');
  const updateAgent = useUpdateAgent();

  const actionLabelClass =
    'max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-24 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-24 group-focus-visible:opacity-100';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading agents...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <div className="text-destructive">Error loading agents</div>
        <pre className="text-xs text-muted-foreground max-w-md overflow-auto">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4">
      <Header title="AI Agents" description="Manage your AI agents and their configurations">
        <Button asChild>
          <Link to="/agents/create">
            <Plus className="mr-2 h-4 w-4" />
            Create Agent
          </Link>
        </Button>
      </Header>

      {agents && agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No agents yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first AI agent to get started with CoreAgent
            </p>
            <Button asChild>
              <Link to="/agents/create">
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Agent
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {agents?.map((agent) => (
            <Card key={agent.id} className="relative flex h-full flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-5 w-5" />
                    <CardTitle className="text-lg">{agent.name}</CardTitle>
                  </div>
                  <Select
                    value={agent.state}
                    onValueChange={(value) =>
                      updateAgent.mutate({
                        agentId: agent.id,
                        updates: { state: value as Agent['state'] },
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className={`w-[120px] ${statusUi[agent.state].triggerClass}`}
                      aria-label="Agent status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="active">
                        <span className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${statusUi.active.dotClass}`} />
                          {statusUi.active.label}
                        </span>
                      </SelectItem>
                      <SelectItem value="paused">
                        <span className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${statusUi.paused.dotClass}`} />
                          {statusUi.paused.label}
                        </span>
                      </SelectItem>
                      <SelectItem value="stopped">
                        <span className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${statusUi.stopped.dotClass}`} />
                          {statusUi.stopped.label}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <CardDescription className="line-clamp-2">
                  {agent.persona}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Provider:</span>
                    <Badge variant="outline">{agent.provider_type}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Model:</span>
                    <span className="font-mono">{agent.model_id}</span>
                  </div>
                  <div className="flex w-full items-center gap-2">
                    <Button variant="outline" size="sm" className="group h-9 gap-0 px-2" asChild>
                      <Link to="/agents/$agentId/dashboard" params={{ agentId: agent.id }}>
                        <BarChart3 className="h-4 w-4 shrink-0" />
                        <span className={actionLabelClass}>Dashboard</span>
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="group h-9 gap-0 px-2" asChild>
                      <Link to="/agents/$agentId/chat" params={{ agentId: agent.id }} search={{ conversationId: undefined }}>
                        <MessageSquare className="h-4 w-4 shrink-0" />
                        <span className={actionLabelClass}>Chat</span>
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="group h-9 gap-0 px-2" asChild>
                      <Link to="/agents/$agentId/voice" params={{ agentId: agent.id }} search={{ conversationId: undefined }}>
                        <Mic className="h-4 w-4 shrink-0" />
                        <span className={actionLabelClass}>Mic</span>
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="group h-9 gap-0 px-2" asChild>
                      <Link to="/agents/$agentId/memory" params={{ agentId: agent.id }}>
                        <Brain className="h-4 w-4 shrink-0" />
                        <span className={actionLabelClass}>Memory</span>
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="group h-9 gap-0 px-2" asChild>
                      <Link to="/agents/$agentId/settings" params={{ agentId: agent.id }}>
                        <Settings className="h-4 w-4 shrink-0" />
                        <span className={actionLabelClass}>Settings</span>
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}