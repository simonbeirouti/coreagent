export const agentKeys = {
  all: ['agents'] as const,
  lists: () => [...agentKeys.all, 'list'] as const,
  list: (userId: string) => [...agentKeys.lists(), userId] as const,
  details: () => [...agentKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

export const conversationKeys = {
  all: ['conversations'] as const,
  lists: () => [...conversationKeys.all, 'list'] as const,
  list: (agentId: string) => [...conversationKeys.lists(), agentId] as const,
  details: () => [...conversationKeys.all, 'detail'] as const,
  detail: (id: string) => [...conversationKeys.details(), id] as const,
  messages: (conversationId: string) =>
    [...conversationKeys.all, 'messages', conversationId] as const,
};

export const userProfileKeys = {
  all: ['userProfile'] as const,
  profile: (userId: string) => [...userProfileKeys.all, userId] as const,
};

export const abilityKeys = {
  all: ['abilities'] as const,
  agent: (agentId: string) => [...abilityKeys.all, 'agent', agentId] as const,
};

export const feedbackKeys = {
  all: ['feedback'] as const,
  stats: (agentId: string) => [...feedbackKeys.all, 'stats', agentId] as const,
  adjustments: (agentId: string) =>
    [...feedbackKeys.all, 'adjustments', agentId] as const,
};

export const memoryKeys = {
  all: ['memory'] as const,
  search: (agentId: string, query: string, conversationId?: string) =>
    [...memoryKeys.all, 'search', agentId, query, conversationId] as const,
};

export const perceptionKeys = {
  all: ['perception-stats'] as const,
  stats: (agentId: string) => [...perceptionKeys.all, agentId] as const,
};
