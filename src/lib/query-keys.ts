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
  skillRatings: (agentId: string) => [...abilityKeys.all, 'skill-ratings', agentId] as const,
  skillTrends: (agentId: string, days: number) =>
    [...abilityKeys.all, 'skill-trends', agentId, days] as const,
};

export const feedbackKeys = {
  all: ['feedback'] as const,
  stats: (agentId: string) => [...feedbackKeys.all, 'stats', agentId] as const,
  monthly: (agentId: string) => [...feedbackKeys.all, 'monthly', agentId] as const,
  adjustments: (agentId: string) =>
    [...feedbackKeys.all, 'adjustments', agentId] as const,
  traitState: (agentId: string) => [...feedbackKeys.all, 'trait-state', agentId] as const,
  conversation: (conversationId: string, userId: string) =>
    [...feedbackKeys.all, 'conversation', conversationId, userId] as const,
};

export const memoryKeys = {
  all: ['memory'] as const,
  search: (agentId: string, query: string, conversationId?: string) =>
    [...memoryKeys.all, 'search', agentId, query, conversationId] as const,
  quality: (agentId: string, days: number) =>
    [...memoryKeys.all, 'quality', agentId, days] as const,
  qualityTimeseries: (agentId: string, days: number) =>
    [...memoryKeys.all, 'quality-timeseries', agentId, days] as const,
  tuningStatus: (agentId: string) =>
    [...memoryKeys.all, 'tuning-status', agentId] as const,
};

export const perceptionKeys = {
  all: ['perception-stats'] as const,
  stats: (agentId: string) => [...perceptionKeys.all, agentId] as const,
};
