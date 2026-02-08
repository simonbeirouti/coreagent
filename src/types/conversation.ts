// Conversation-related TypeScript types

export interface Conversation {
  id: string;
  agent_id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  message_type: 'text' | 'image' | 'audio';
  metadata: Record<string, any>;
  created_at: string;
}

export interface CreateConversationRequest {
  agent_id: string;
  user_id: string;
  title?: string;
}

export interface SendMessageRequest {
  conversation_id: string;
  content: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
  agent_name?: string;
}