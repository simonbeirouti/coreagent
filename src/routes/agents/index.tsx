import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from '@/hooks/use-auth';
import { useAgents } from '@/hooks/useAgents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Bot, MessageSquare, MoreHorizontal, Brain, Mic, Settings, BarChart3 } from 'lucide-react';
import { Header } from '@/components/header';

export const Route = createFileRoute('/agents/')({
  component: AgentsPage,
});

function AgentsPage() {
  const { user } = useAuth();
  const { data: agents, isLoading, error } = useAgents(user?.id || '');

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
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map((agent) => (
            <Card key={agent.id} className="relative flex h-full flex-col">
              <CardHeader>
                <div className="flex items-start gap-2">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-5 w-5" />
                    <CardTitle className="text-lg">{agent.name}</CardTitle>
                  </div>
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
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" asChild>
                        <Link to="/agents/$agentId/dashboard" params={{ agentId: agent.id }}>
                          <BarChart3 className="h-4 w-4" />
                          <span className="sr-only">Dashboard</span>
                        </Link>
                      </Button>
                      <Button variant="outline" size="icon" asChild>
                        <Link to="/agents/$agentId/chat" params={{ agentId: agent.id }} search={{ conversationId: undefined }}>
                          <MessageSquare className="h-4 w-4" />
                          <span className="sr-only">Chat</span>
                        </Link>
                      </Button>
                      <Button variant="outline" size="icon" asChild>
                        <Link to="/agents/$agentId/memory" params={{ agentId: agent.id }}>
                          <Brain className="h-4 w-4" />
                          <span className="sr-only">Brain</span>
                        </Link>
                      </Button>
                      <Button variant="outline" size="icon" asChild>
                        <Link to="/agents/$agentId/voice" params={{ agentId: agent.id }} search={{ conversationId: undefined }}>
                          <Mic className="h-4 w-4" />
                          <span className="sr-only">Mic</span>
                        </Link>
                      </Button>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="ml-auto">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open card menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to="/agents/$agentId/settings" params={{ agentId: agent.id }}>
                            <Settings className="h-4 w-4" />
                            Settings
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem>Active</DropdownMenuItem>
                            <DropdownMenuItem>Ideal</DropdownMenuItem>
                            <DropdownMenuItem>Stop</DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </DropdownMenuContent>
                    </DropdownMenu>
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