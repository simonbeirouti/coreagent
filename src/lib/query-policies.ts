export const QUERY_GC_TIME_MS = 24 * 60 * 60 * 1000;

export const cacheFirstStaticQueryPolicy = {
  staleTime: Infinity,
  gcTime: QUERY_GC_TIME_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const dynamic30sQueryPolicy = {
  staleTime: 30 * 1000,
  gcTime: QUERY_GC_TIME_MS,
  refetchInterval: 30 * 1000,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

export const shortSearchQueryPolicy = {
  staleTime: 15 * 1000,
  gcTime: QUERY_GC_TIME_MS,
  refetchOnMount: true,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
} as const;
