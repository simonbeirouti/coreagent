import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from '@/hooks/use-auth';
import { useAgents, useDeleteAgent } from '@/hooks/useAgents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Bot, Trash2, Edit, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '@/components/header';

export const Route = createFileRoute('/agents/')({
  component: AgentsPage,
});

function AgentsPage() {
  const { user } = useAuth();
  const { data: agents, isLoading, error } = useAgents(user?.id || '');
  const deleteAgentMutation = useDeleteAgent();

  const handleDeleteAgent = async (agentId: string) => {
    try {
      await deleteAgentMutation.mutateAsync(agentId);
      toast.success('Agent deleted successfully');
    } catch (error) {
      toast.error('Failed to delete agent');
      console.error('Delete agent error:', error);
    }
  };

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
            <Card key={agent.id} className="relative">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-5 w-5" />
                    <CardTitle className="text-lg">{agent.name}</CardTitle>
                  </div>
                  <Badge variant={agent.state === 'active' ? 'default' : 'secondary'}>
                    {agent.state}
                  </Badge>
                </div>
                <CardDescription className="line-clamp-2">
                  {agent.persona}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Provider:</span>
                    <Badge variant="outline">{agent.provider_type}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Model:</span>
                    <span className="font-mono">{agent.model_id}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/agents/$agentId/settings" params={{ agentId: agent.id }}>
                        <Edit className="mr-1 h-3 w-3" />
                        Settings
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/agents/$agentId/chat" params={{ agentId: agent.id }}>
                        <MessageSquare className="mr-1 h-3 w-3" />
                        Chat
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{agent.name}"? This action cannot be undone.
                            All conversations with this agent will also be deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteAgent(agent.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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