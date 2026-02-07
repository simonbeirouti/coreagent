import { Store } from '@tauri-apps/plugin-store';
import { QueryClient } from '@tanstack/react-query';

// Store file path
const CACHE_STORE_PATH = 'query-cache.json';

// Cache store instance (lazy loaded)
let cacheStore: Store | null = null;

// In-memory cache for synchronous access
let memoryCache: SerializedCache | null = null;

/**
 * Get or create the cache store instance
 */
async function getCacheStore(): Promise<Store> {
  if (!cacheStore) {
    cacheStore = await Store.load(CACHE_STORE_PATH);
  }
  return cacheStore;
}

/**
 * Cache entry structure
 */
interface CacheEntry {
  data: any;
  dataUpdatedAt: number;
  error: any | null;
  errorUpdatedAt: number | null;
  isStale: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
}

/**
 * Serialized cache structure
 */
interface SerializedCache {
  queries: Record<string, CacheEntry>;
  timestamp: number;
}

/**
 * Load cached queries from the Tauri store
 */
export async function loadCache(): Promise<SerializedCache | null> {
  try {
    const store = await getCacheStore();
    const cached = await store.get<SerializedCache>('cache');

    if (!cached || !cached.queries) {
      return null;
    }

    // Validate cache age (don't use cache older than 24 hours)
    const cacheAge = Date.now() - cached.timestamp;
    const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours

    if (cacheAge > MAX_CACHE_AGE) {
      console.log('[Cache] Cache too old, ignoring');
      return null;
    }

    console.log(`[Cache] Loaded ${Object.keys(cached.queries).length} cached queries`);
    return cached;
  } catch (error) {
    console.warn('[Cache] Failed to load cache:', error);
    return null;
  }
}

/**
 * Save the current React Query cache to the Tauri store
 */
export async function saveCache(queryClient: QueryClient): Promise<void> {
  try {
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll();

    const serializedQueries: Record<string, CacheEntry> = {};

    for (const query of queries) {
      // Only cache successful queries with data
      if (query.state.status === 'success' && query.state.data !== undefined) {
        const queryKey = JSON.stringify(query.queryKey);
        serializedQueries[queryKey] = {
          data: query.state.data,
          dataUpdatedAt: query.state.dataUpdatedAt,
          error: query.state.error,
          errorUpdatedAt: query.state.errorUpdatedAt,
          isStale: query.state.isInvalidated,
          isFetching: query.state.fetchStatus === 'fetching',
          isSuccess: true,
          isError: false,
        };
      }
    }

    const serializedCache: SerializedCache = {
      queries: serializedQueries,
      timestamp: Date.now(),
    };

    const store = await getCacheStore();
    await store.set('cache', serializedCache);

    console.log(`[Cache] Saved ${Object.keys(serializedQueries).length} queries to disk`);
  } catch (error) {
    console.warn('[Cache] Failed to save cache:', error);
  }
}

/**
 * Clear the cached queries from the Tauri store
 */
export async function clearCache(): Promise<void> {
  try {
    const store = await getCacheStore();
    await store.delete('cache');
    console.log('[Cache] Cleared cached queries');
  } catch (error) {
    console.warn('[Cache] Failed to clear cache:', error);
  }
}

/**
 * Initialize in-memory cache for synchronous access
 */
export async function initializeMemoryCache(): Promise<void> {
  if (memoryCache) return; // Already initialized

  try {
    memoryCache = await loadCache();
    console.log('[Cache] Memory cache initialized');
  } catch (error) {
    console.warn('[Cache] Failed to initialize memory cache:', error);
    memoryCache = null;
  }
}

/**
 * Module-level promise for cache initialization
 */
let cacheInitPromise: Promise<void> | null = null;

/**
 * Ensure cache is loaded synchronously before React renders
 * Returns a promise that resolves when cache is ready
 */
export function ensureCacheLoaded(): Promise<void> {
  if (memoryCache !== null) {
    return Promise.resolve();
  }
  if (!cacheInitPromise) {
    cacheInitPromise = loadCache().then(cache => {
      memoryCache = cache;
      console.log('[Cache] Module-level cache loaded');
    }).catch(error => {
      console.warn('[Cache] Failed to load module cache:', error);
      memoryCache = null;
    });
  }
  return cacheInitPromise;
}

/**
 * Get cached data synchronously for a specific query key
 */
export function getCachedData<T = any>(queryKey: any): T | undefined {
  if (!memoryCache || !memoryCache.queries) return undefined;

  const queryKeyString = JSON.stringify(queryKey);
  const entry = memoryCache.queries[queryKeyString];

  if (!entry || entry.isError) return undefined;

  // Check if cache is still fresh (not older than 24 hours)
  const cacheAge = Date.now() - memoryCache.timestamp;
  const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;

  if (cacheAge > MAX_CACHE_AGE) {
    console.log(`[Cache] Cached data too old for query: ${queryKeyString}`);
    return undefined;
  }

  return entry.data as T;
}

/**
 * Get the timestamp when cached data was updated
 */
export function getCachedDataUpdatedAt(queryKey: any): number | undefined {
  if (!memoryCache || !memoryCache.queries) return undefined;

  const queryKeyString = JSON.stringify(queryKey);
  const entry = memoryCache.queries[queryKeyString];

  return entry?.dataUpdatedAt;
}

/**
 * Hydrate React Query cache with persisted data
 */
export async function hydrateCache(queryClient: QueryClient): Promise<void> {
  const cached = await loadCache();
  if (!cached) return;

  const cache = queryClient.getQueryCache();

  for (const [queryKeyString, entry] of Object.entries(cached.queries)) {
    try {
      const queryKey = JSON.parse(queryKeyString);

      // Only hydrate if we don't already have fresher data
      const existingQuery = cache.find(queryKey);
      if (existingQuery && existingQuery.state.dataUpdatedAt > entry.dataUpdatedAt) {
        continue; // Skip hydration, we have fresher data
      }

      // Set the cached data
      queryClient.setQueryData(queryKey, entry.data);

      console.log(`[Cache] Hydrated query: ${queryKeyString}`);
    } catch (error) {
      console.warn(`[Cache] Failed to hydrate query ${queryKeyString}:`, error);
    }
  }
}