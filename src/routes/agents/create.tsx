import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { useCreateAgent } from '@/hooks/useAgents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BehavioralConstraintsBuilder } from '@/components/behavioral-constraints-builder';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  persona: z.string().min(10, 'Persona must be at least 10 characters').max(1000, 'Persona must be less than 1000 characters'),
  provider_type: z.enum(['openai', 'anthropic']),
  model_id: z.string().min(1, 'Model is required'),
  mission: z.string().optional(),
  values: z.array(z.string()).optional(),
  behavioral_constraints: z.record(z.string(), z.any()).optional(),
});

type CreateAgentForm = z.infer<typeof createAgentSchema>;

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

export const Route = createFileRoute('/agents/create')({
  component: CreateAgentPage,
});

function CreateAgentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const createAgentMutation = useCreateAgent();

  const form = useForm<CreateAgentForm>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: {
      name: '',
      persona: '',
      provider_type: 'openai',
      model_id: 'gpt-4o',
      mission: '',
      values: [],
      behavioral_constraints: {},
    },
  });

  const selectedProvider = form.watch('provider_type');
  const availableModels = PROVIDER_MODELS[selectedProvider];

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

  const onSubmit = async (data: CreateAgentForm) => {
    if (!user?.id) {
      toast.error('User not authenticated');
      return;
    }

    try {
      // Process the values array: filter out empty strings
      const processedData = {
        ...data,
        values: data.values
          ? data.values.filter((v: string) => v.trim().length > 0)
          : undefined,
        user_id: user.id,
      };

      await createAgentMutation.mutateAsync(processedData);

      toast.success('Agent created successfully!');
      navigate({ to: '/agents' });
    } catch (error) {
      toast.error('Failed to create agent');
      console.error('Create agent error:', error);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/agents' })}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Agents
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Create New Agent</CardTitle>
              <CardDescription>
                Configure a new AI agent with personality and capabilities
              </CardDescription>
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
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Code Assistant, Research Buddy" {...field} />
                    </FormControl>
                    <FormDescription>
                      A descriptive name for your agent
                    </FormDescription>
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
                      <Textarea
                        placeholder="Describe how this agent should behave, its expertise, communication style, etc."
                        className="min-h-32"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Define the agent's personality, expertise, and how it should interact with users
                    </FormDescription>
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
                    <FormDescription>
                      Define the agent's primary purpose and objective
                    </FormDescription>
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
                      <Textarea
                        placeholder="Enter core values (one per line):&#10;Helpfulness&#10;Honesty&#10;Precision"
                        className="min-h-24"
                        value={field.value?.join('\n') || ''}
                        onChange={(e) => {
                          const lines = e.target.value.split('\n');
                          field.onChange(lines);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Principles that guide the agent's behavior (one per line)
                    </FormDescription>
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
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the AI model provider
                      </FormDescription>
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
                            <SelectValue placeholder="Select model" />
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
                      <FormDescription>
                        Select the specific AI model
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex gap-4">
                <Button
                  type="submit"
                  disabled={createAgentMutation.isPending}
                  className="flex-1"
                >
                  {createAgentMutation.isPending ? 'Creating...' : 'Create Agent'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: '/agents' })}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}