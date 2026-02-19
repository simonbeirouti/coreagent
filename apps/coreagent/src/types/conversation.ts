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
  /** Parent message ID for branching support. NULL for root messages. */
  parent_id?: string | null;
}

export interface CreateConversationRequest {
  agent_id: string;
  user_id: string;
  title?: string;
}

export interface SendMessageRequest {
  conversation_id: string;
  content: string;
  image_base64?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
  agent_name?: string;
}

// Streaming event types for AI responses
export type StreamEvent =
  | { type: 'Started' }
  | { type: 'Delta'; data: { content: string } }
  | { type: 'Done'; data: { full_content: string } }
  | { type: 'Error'; data: { message: string } };