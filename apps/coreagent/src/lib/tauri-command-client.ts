import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  Agent,
  Conversation,
  CreateAgentRequest,
  CreateConversationRequest,
  Message,
  SendMessageRequest,
  StreamEvent,
  UpdateAgentRequest,
} from '@/types';

// Frontend-only command surface. DB access remains backend-owned.
export const tauriCommandClient = {
  // Agents
  listAgents(userId: string) {
    return invoke<Agent[]>('list_agents', { userId });
  },
  getAgent(agentId: string) {
    return invoke<Agent>('get_agent', { agentId });
  },
  createAgent(request: CreateAgentRequest) {
    return invoke<Agent>('create_agent', { request });
  },
  updateAgent(agentId: string, updates: UpdateAgentRequest) {
    return invoke<Agent>('update_agent', { agentId, updates });
  },
  deleteAgent(agentId: string) {
    return invoke<void>('delete_agent', { agentId });
  },
  listProviderModels(providerType: 'openai' | 'anthropic') {
    return invoke<Array<{ id: string; provider: 'openai' | 'anthropic'; display_name: string }>>(
      'list_provider_models',
      { providerType }
    );
  },
  createOrchestrationProject(request: {
    manager_agent_id: string;
    name: string;
    objective: string;
    priority?: 'low' | 'normal' | 'high';
  }) {
    return invoke<{
      id: string;
      owner_user_id: string;
      manager_agent_id: string;
      run_id: string;
      manager_conversation_id?: string | null;
      name: string;
      objective: string;
      status: string;
      manager_agent_name: string;
      manager_model_id: string;
      created_at: string;
      updated_at: string;
    }>('create_orchestration_project', { request });
  },
  listOrchestrationProjects() {
    return invoke<Array<{
      id: string;
      owner_user_id: string;
      manager_agent_id: string;
      run_id: string;
      manager_conversation_id?: string | null;
      name: string;
      objective: string;
      status: string;
      manager_agent_name: string;
      manager_model_id: string;
      created_at: string;
      updated_at: string;
    }>>('list_orchestration_projects');
  },
  getCurrentOrchestrationProject() {
    return invoke<{
      id: string;
      owner_user_id: string;
      manager_agent_id: string;
      run_id: string;
      manager_conversation_id?: string | null;
      name: string;
      objective: string;
      status: string;
      manager_agent_name: string;
      manager_model_id: string;
      created_at: string;
      updated_at: string;
    } | null>('get_current_orchestration_project');
  },
  setCurrentOrchestrationProject(projectId: string) {
    return invoke<{
      id: string;
      owner_user_id: string;
      manager_agent_id: string;
      run_id: string;
      manager_conversation_id?: string | null;
      name: string;
      objective: string;
      status: string;
      manager_agent_name: string;
      manager_model_id: string;
      created_at: string;
      updated_at: string;
    } | null>('set_current_orchestration_project', { projectId });
  },
  ensureProjectManagerConversation(projectId: string) {
    return invoke<Conversation>('ensure_project_manager_conversation', { projectId });
  },
  sendProjectManagerMessage(projectId: string, content: string) {
    return invoke<Message>('send_project_manager_message', { projectId, content });
  },

  // Conversations and messages
  listConversations(agentId: string) {
    return invoke<Conversation[]>('list_conversations', { agentId });
  },
  getConversation(conversationId: string) {
    return invoke<Conversation>('get_conversation', { conversationId });
  },
  getConversationMessages(conversationId: string) {
    return invoke<Message[]>('get_conversation_messages', { conversationId });
  },
  createConversation(request: CreateConversationRequest) {
    return invoke<Conversation>('create_conversation', { request });
  },
  sendMessage(request: SendMessageRequest) {
    return invoke<Message>('send_message', {
      conversationId: request.conversation_id,
      content: request.content,
      imageBase64: request.image_base64,
    });
  },
  sendMessageStreaming(request: SendMessageRequest, onEvent: Channel<StreamEvent>) {
    return invoke<Message>('send_message_streaming', {
      conversationId: request.conversation_id,
      content: request.content,
      imageBase64: request.image_base64,
      onEvent,
    });
  },
  updateConversationTitle(conversationId: string, title: string | null) {
    return invoke<Conversation>('update_conversation_title', { conversationId, title });
  },
  generateConversationTitle(conversationId: string, firstMessage: string) {
    return invoke<Conversation>('generate_conversation_title', { conversationId, firstMessage });
  },
  deleteConversation(conversationId: string) {
    return invoke<void>('delete_conversation', { conversationId });
  },
  deleteMessage(messageId: string) {
    return invoke<string[]>('delete_message', { messageId });
  },
  editMessage(messageId: string, newContent: string, imageBase64?: string) {
    return invoke<[Message, Message]>('edit_message', {
      messageId,
      newContent,
      imageBase64,
    });
  },
  editMessageStreaming(messageId: string, newContent: string, onEvent: Channel<StreamEvent>, imageBase64?: string) {
    return invoke<[Message, Message]>('edit_message_streaming', {
      messageId,
      newContent,
      imageBase64,
      onEvent,
    });
  },

  // Abilities and memory analytics (typed at hook call-site)
  listAgentAbilities<T>(agentId: string) {
    return invoke<T>('list_agent_abilities', { agentId });
  },
  listAgentToolSettings<T>(agentId: string) {
    return invoke<T>('list_agent_tool_settings', { agentId });
  },
  listAgentRegistrySkills<T>(agentId: string) {
    return invoke<T>('list_agent_registry_skills', { agentId });
  },
  getAgentSkillRatings<T>(agentId: string) {
    return invoke<T>('get_agent_skill_ratings', { agentId });
  },
  getAgentSkillRatingTrends<T>(agentId: string, days: number) {
    return invoke<T>('get_agent_skill_rating_trends', { agentId, days });
  },
  setAgentAbilityEnabled<T>(agentId: string, implementationKey: string, enabled: boolean) {
    return invoke<T>('set_agent_ability_enabled', { agentId, implementationKey, enabled });
  },
  updateAgentAbilityConfig<T>(agentId: string, implementationKey: string, config: Record<string, unknown>) {
    return invoke<T>('update_agent_ability_config', { agentId, implementationKey, config });
  },
  getRelevantMemories<T>(agentId: string, query: string, conversationId?: string) {
    return invoke<T>('get_relevant_memories', { agentId, query, conversationId });
  },
  getAgentRetrievalQualitySummary<T>(agentId: string, days: number) {
    return invoke<T>('get_agent_retrieval_quality_summary', { agentId, days });
  },
  getAgentRetrievalQualityTimeseries<T>(agentId: string, days: number) {
    return invoke<T>('get_agent_retrieval_quality_timeseries', { agentId, days });
  },
  getAgentRetrievalTuningStatus<T>(agentId: string) {
    return invoke<T>('get_agent_retrieval_tuning_status', { agentId });
  },
};
