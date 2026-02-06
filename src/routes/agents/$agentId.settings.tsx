import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAgent, useUpdateAgent, useDeleteAgent } from '@/hooks/useAgents';
import { useConversations } from '@/hooks/useConversations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Bot, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const updateAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  persona: z.string().min(10, 'Persona must be at least 10 characters').max(1000, 'Persona must be less than 1000 characters'),
  provider_type: z.enum(['openai', 'anthropic']),
  model_id: z.string().min(1, 'Model is required'),
  state: z.enum(['active', 'paused', 'stopped']),
});

type UpdateAgentForm = z.infer<typeof updateAgentSchema>;

const PROVIDER_MODELS = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
  ],
};

export const Route = createFileRoute('/agents/$agentId/settings')({
  component: AgentSettingsPage,
});

function AgentSettingsPage() {
  const navigate = useNavigate();
  const { agentId } = Route.useParams();
  
  const { data: agent, isLoading, error } = useAgent(agentId);
  const { data: conversations } = useConversations(agentId);
  const updateAgentMutation = useUpdateAgent();
  const deleteAgentMutation = useDeleteAgent();

  const form = useForm<UpdateAgentForm>({
    resolver: zodResolver(updateAgentSchema),
    values: agent ? {
      name: agent.name,
      persona: agent.persona,
      provider_type: agent.provider_type,
      model_id: agent.model_id,
      state: agent.state,
    } : undefined,
  });

  const selectedProvider = form.watch('provider_type');
  const availableModels = selectedProvider ? PROVIDER_MODELS[selectedProvider] : [];

  const onSubmit = async (data: UpdateAgentForm) => {
    try {
      await updateAgentMutation.mutateAsync({
        agentId,
        updates: data,
      });

      toast.success('Agent updated successfully!');
    } catch (error) {
      toast.error('Failed to update agent');
      console.error('Update agent error:', error);
    }
  };

  const handleDeleteAgent = async () => {
    try {
      await deleteAgentMutation.mutateAsync(agentId);
      toast.success('Agent deleted successfully');
      navigate({ to: '/agents' });
    } catch (error) {
      toast.error('Failed to delete agent');
      console.error('Delete agent error:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading agent...</div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">Error loading agent</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Agent Configuration */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Bot className="h-6 w-6" />
                  <div>
                    <CardTitle>Agent Configuration</CardTitle>
                    <CardDescription>Edit agent settings and personality</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Agent Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="persona"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Personality & Instructions</FormLabel>
                          <FormControl>
                            <Textarea className="min-h-32" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="provider_type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>AI Provider</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="anthropic">Anthropic</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="model_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Model</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {availableModels.map((model) => (
                                  <SelectItem key={model.id} value={model.id}>
                                    {model.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="paused">Paused</SelectItem>
                              <SelectItem value="stopped">Stopped</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      disabled={updateAgentMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateAgentMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>

          {/* Agent Info & Actions */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Agent Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  <Badge variant={agent.state === 'active' ? 'default' : 'secondary'}>
                    {agent.state}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Provider</span>
                  <Badge variant="outline">{agent.provider_type}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Model</span>
                  <span className="text-sm text-muted-foreground font-mono">
                    {agent.model_id}
                  </span>
                </div>
                <Separator />
                <div className="text-xs text-muted-foreground">
                  Created: {new Date(agent.created_at).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>

            {/* Recent Conversations */}
            {conversations && conversations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Conversations</CardTitle>
                  <CardDescription>Last {Math.min(conversations.length, 5)} conversations</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {conversations.slice(0, 5).map((conversation) => (
                      <button
                        key={conversation.id}
                        onClick={() => {
                          navigate({ 
                            to: '/agents/$agentId/chat', 
                            params: { agentId },
                            search: { conversationId: conversation.id }
                          });
                        }}
                        className="flex items-center justify-between text-sm w-full hover:bg-accent rounded-md p-2 transition-colors"
                      >
                        <span className="truncate flex-1 text-left">
                          {conversation.title || 'Untitled Conversation'}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          {new Date(conversation.updated_at).toLocaleDateString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Danger Zone */}
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>Irreversible actions</CardDescription>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Agent
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
                        onClick={handleDeleteAgent}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
