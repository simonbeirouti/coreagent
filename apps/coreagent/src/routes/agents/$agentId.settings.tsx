import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAgent, useUpdateAgent, useDeleteAgent } from '@/hooks/useAgents';
import { useConversations } from '@/hooks/useConversations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { BehavioralConstraintsBuilder } from '@/components/behavioral-constraints-builder';
import { Bot, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

const updateAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  persona: z.string().min(10, 'Persona must be at least 10 characters').max(1000, 'Persona must be less than 1000 characters'),
  provider_type: z.enum(['openai', 'anthropic']),
  model_id: z.string().min(1, 'Model is required'),
  state: z.enum(['active', 'paused', 'stopped']),
  mission: z.string().optional(),
  values: z.array(z.string()).optional(),
  behavioral_constraints: z.record(z.string(), z.any()).optional(),
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
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  ],
};

// Core Values Input Component
function CoreValuesInput({ value, onChange }: { value: string[], onChange: (values: string[]) => void }) {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addValue();
    }
  };

  const addValue = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !value.includes(trimmedValue)) {
      onChange([...value, trimmedValue]);
      setInputValue('');
    }
  };

  const removeValue = (valueToRemove: string) => {
    onChange(value.filter(v => v !== valueToRemove));
  };

  return (
    <div className="relative">
      <div className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <div className="flex flex-wrap items-center gap-1">
          {value.map((val) => (
            <Badge key={val} variant="secondary" className="flex items-center gap-1 h-6 px-2 text-xs">
              {val}
              <button
                onClick={() => removeValue(val)}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={addValue}
            placeholder={value.length === 0 ? "Type a value and press Enter or comma to add..." : ""}
            className="border-0 p-0 h-6 min-w-20 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      </div>
    </div>
  );
}

// Function to calculate and format birthday/age information
function formatBirthdayInfo(createdAt: string) {
  const created = new Date(createdAt);
  const now = new Date();
  const ms = now.getTime() - created.getTime();
  const oneHour = 1000 * 60 * 60;
  const oneDay = 1000 * 60 * 60 * 24;
  const oneMonth = oneDay * 30.4375; // average month
  const oneYear = oneDay * 365.25;

  let ageStr = '';

  if (ms < oneDay) {
    const hours = Math.floor(ms / oneHour);
    ageStr = `${hours <= 1 ? '1 hour' : `${hours} hours`} old`;
  } else if (ms < oneMonth) {
    const days = Math.floor(ms / oneDay);
    ageStr = `${days <= 1 ? '1 day' : `${days} days`} old`;
  } else if (ms < oneYear) {
    const months = Math.floor(ms / oneMonth);
    ageStr = `${months <= 1 ? '1 month' : `${months} months`} old`;
  } else {
    const years = Math.floor(ms / oneYear);
    ageStr = `${years <= 1 ? '1 year' : `${years} years`} old`;
  }

  return {
    date: created.toLocaleDateString(),
    age: ageStr
  };
}

// Comprehensive agent templates with full identity data
const AGENT_TEMPLATES: Record<string, {
  persona: string;
  mission: string;
  values: string[];
  behavioral_constraints: Record<string, any>;
}> = {
  'Professional Assistant': {
    persona: 'I am a professional, knowledgeable assistant focused on providing accurate, well-researched information. I communicate clearly and maintain a formal yet approachable tone. I prioritize accuracy and helpfulness in all my responses.',
    mission: 'Provide reliable, accurate assistance with a focus on productivity and professional excellence.',
    values: ['Accuracy', 'Professionalism', 'Clarity', 'Efficiency'],
    behavioral_constraints: {
      tone: 'professional',
      response_style: 'detailed',
      content_filtering: true,
      age_appropriate: true,
    },
  },
  'Creative Writer': {
    persona: 'I am a creative and imaginative writer who loves storytelling, wordplay, and exploring ideas through narrative. I bring enthusiasm and artistic flair to every conversation, making even mundane topics engaging and memorable.',
    mission: 'Inspire creativity and help bring ideas to life through compelling, imaginative writing.',
    values: ['Creativity', 'Imagination', 'Expressiveness', 'Originality'],
    behavioral_constraints: {
      tone: 'casual',
      response_style: 'detailed',
      humor_level: 'moderate',
      max_response_length: 1000,
    },
  },
  'Technical Expert': {
    persona: 'I am a precise, methodical technical expert with deep knowledge across software engineering, systems architecture, and best practices. I explain complex concepts clearly and provide thorough, well-structured guidance.',
    mission: 'Provide deep technical expertise and clear explanations to help solve complex problems.',
    values: ['Precision', 'Thoroughness', 'Technical Excellence', 'Clarity'],
    behavioral_constraints: {
      tone: 'professional',
      response_style: 'technical',
      question_answering: 'step-by-step',
      content_filtering: false,
    },
  },
  'Customer Support': {
    persona: 'I am a friendly, patient, and solution-oriented support specialist. I listen carefully to concerns, show empathy, and work diligently to find the best resolution. I maintain a positive, helpful attitude throughout every interaction.',
    mission: 'Resolve issues quickly and effectively while maintaining positive, supportive relationships.',
    values: ['Empathy', 'Patience', 'Responsiveness', 'Problem-Solving'],
    behavioral_constraints: {
      tone: 'friendly',
      response_style: 'concise',
      follow_up_questions: 'ask_permission',
      clarification_requests: 'when_needed',
    },
  },
  'Research Analyst': {
    persona: 'I am an analytical, methodical researcher focused on evidence-based insights. I approach topics with objectivity and rigor, always citing sources and acknowledging limitations. I excel at synthesizing complex information into clear findings.',
    mission: 'Provide in-depth analysis with properly cited sources and well-reasoned conclusions.',
    values: ['Objectivity', 'Rigor', 'Evidence-Based Reasoning', 'Thoroughness'],
    behavioral_constraints: {
      tone: 'professional',
      response_style: 'detailed',
      question_answering: 'comprehensive',
      content_filtering: true,
    },
  },
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
      mission: agent.mission || '',
      values: agent.values || [],
      behavioral_constraints: agent.behavioral_constraints || {},
    } : undefined,
  });

  const selectedProvider = form.watch('provider_type');
  const availableModels = selectedProvider ? PROVIDER_MODELS[selectedProvider] : [];

  // Reset model_id to first available model when provider changes
  useEffect(() => {
    // Only run this effect when we have a valid selectedProvider and agent data is loaded
    if (!selectedProvider || !agent) return;

    const models = PROVIDER_MODELS[selectedProvider];
    const currentModelId = form.getValues('model_id');
    // If current model doesn't exist in new provider's list, set to first model
    if (models && models.length > 0 && !models.find(m => m.id === currentModelId)) {
      form.setValue('model_id', models[0].id);
    }
  }, [selectedProvider, form, agent]);

  const onSubmit = async (data: UpdateAgentForm) => {
    try {
      // Process the values array: filter out empty strings
      const processedData = {
        ...data,
        values: data.values
          ? data.values.filter((v: string) => v.trim().length > 0)
          : undefined,
      };

      await updateAgentMutation.mutateAsync({
        agentId,
        updates: processedData,
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

  const applyTemplate = (templateName: string) => {
    const template = AGENT_TEMPLATES[templateName];
    if (template) {
      form.setValue('persona', template.persona);
      form.setValue('mission', template.mission);
      form.setValue('values', template.values);
      form.setValue('behavioral_constraints', template.behavioral_constraints);
      toast.success(`Applied "${templateName}" template`);
    }
  };

  const birthday = agent ? formatBirthdayInfo(agent.created_at) : { date: '', age: '' };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Main Content Skeleton */}
              <div className="flex-1 order-2 lg:order-1">
                <Card>
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-6 w-6" />
                        <div>
                          <Skeleton className="h-6 w-48 mb-2" />
                          <Skeleton className="h-4 w-64" />
                        </div>
                      </div>
                      <Skeleton className="h-10 w-32" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-48 w-full" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar Skeleton */}
              <div className="w-full lg:w-80 space-y-4 order-1 lg:order-2">
                <Card>
                  <CardHeader>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    {/* Provider and Status in same row */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </div>
                    {/* Model takes full width */}
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <Skeleton className="h-4 w-32" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <div className="flex-1">
                            <Skeleton className="h-4 w-full mb-1" />
                            <Skeleton className="h-3 w-3/4" />
                          </div>
                          <Skeleton className="h-4 w-16" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-destructive">
                  <CardHeader>
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-10 w-full" />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </ScrollArea>
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Main Content - Agent Identity & Personality */}
            <div className="flex-1 order-2 lg:order-1">
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Bot className="h-6 w-6" />
                      <div>
                        <CardTitle>Agent Identity & Personality</CardTitle>
                        <CardDescription>Define the agent's personality, mission, and behavioral guidelines</CardDescription>
                      </div>
                    </div>
                    <Select onValueChange={applyTemplate}>
                      <SelectTrigger className="w-full sm:w-[200px]">
                        <SelectValue placeholder="Apply template..." />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(AGENT_TEMPLATES).map((templateName) => (
                          <SelectItem key={templateName} value={templateName}>
                            {templateName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="persona"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Personality</FormLabel>
                            <FormControl>
                              <Textarea className="min-h-32" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mission"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mission</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="e.g., Help users write clean, maintainable code"
                                className="min-h-24"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="values"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Core Values</FormLabel>
                            <FormControl>
                              <CoreValuesInput
                                value={field.value || []}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="behavioral_constraints"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Behavioral Constraints</FormLabel>
                            <FormDescription>
                              Configure rules and limitations for how the agent should behave
                            </FormDescription>
                            <FormControl>
                              <BehavioralConstraintsBuilder
                                value={field.value || {}}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                    </form>
                  </Form>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar - Agent Controls & Info */}
            <div className="w-full lg:w-80 space-y-4 order-1 lg:order-2">
              <Card>
                <CardHeader>
                  <CardTitle>Agent Controls</CardTitle>
                  <CardDescription>Quick settings and information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Form {...form}>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">Agent Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Provider and Status in same row */}
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="provider_type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">AI Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-full">
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
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Status</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-full">
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
                    </div>

                    {/* Model takes full width */}
                    <FormField
                      control={form.control}
                      name="model_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium">Model</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="w-full">
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
                  </Form>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        🎂 {birthday.date}
                      </span>
                    </div>
                    <span className="text-sm text-foreground font-semibold">
                      {birthday.age}
                    </span>
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

              {/* Save Changes */}
              {form.formState.isDirty && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Unsaved Changes</CardTitle>
                    <CardDescription>Save your changes to the agent settings</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={form.handleSubmit(onSubmit)}
                      disabled={updateAgentMutation.isPending}
                      className="w-full"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateAgentMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
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
      </ScrollArea>
    </div>
  );
}
