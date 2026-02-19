// Agent-related TypeScript types

export interface Agent {
  id: string;
  user_id: string;
  name: string;
  persona: string;
  provider_type: 'openai' | 'anthropic';
  model_id: string;
  state: 'active' | 'paused' | 'stopped';
  mission?: string;
  values?: string[];
  behavioral_constraints?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentRequest {
  name: string;
  persona: string;
  provider_type: 'openai' | 'anthropic';
  model_id: string;
  user_id: string;
  mission?: string;
  values?: string[];
  behavioral_constraints?: Record<string, any>;
}

export interface UpdateAgentRequest {
  name?: string;
  persona?: string;
  provider_type?: 'openai' | 'anthropic';
  model_id?: string;
  state?: 'active' | 'paused' | 'stopped';
  mission?: string;
  values?: string[];
  behavioral_constraints?: Record<string, any>;
}

export interface AgentStats {
  total_agents: number;
  active_agents: number;
  total_conversations: number;
  total_messages: number;
}