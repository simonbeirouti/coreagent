import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { hydrateCache, saveCache } from '@/lib/tauri-store';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';
import { useEffect, useRef, useState } from 'react';

// Create a client
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...cacheFirstStaticQueryPolicy,
        retry: (failureCount: number, error: unknown) => {
          // Don't retry on 4xx errors
          if (error instanceof Error && error.message.includes('4')) {
            return false;
          }
          return failureCount < 3;
        },
      },
      mutations: {
        retry: false, // Don't retry mutations by default
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // NOTE: Avoid useState when initializing the query client if you don't
  // have a suspense boundary between this and the code that may suspend
  // because React will throw away the client on the initial render if
  // it suspends and there is no boundary
  const queryClient = getQueryClient();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const hydrationStartedRef = useRef(false);
  const startupRevalidationDoneRef = useRef(false);

  // Hydrate persisted cache before mounting query consumers.
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;

    hydrateCache(queryClient)
      .catch((error) => {
        console.warn('[QueryProvider] Failed to hydrate cache:', error);
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, [queryClient]);

  // After cache hydration, revalidate active queries once per app boot.
  // This keeps startup fast from cache while still pulling fresh server state.
  useEffect(() => {
    if (!isHydrated || startupRevalidationDoneRef.current) return;
    startupRevalidationDoneRef.current = true;

    void queryClient.invalidateQueries({ refetchType: 'active' });
  }, [isHydrated, queryClient]);

  // Subscribe to cache changes and persist them
  useEffect(() => {
    const flushCacheSave = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      void saveCache(queryClient);
    };

    const unsubscribe = queryClient.getQueryCache().subscribe((event: any) => {
      // Only save on successful mutations or query updates
      if (event.type === 'added' || event.type === 'updated') {
        // Debounce saves to avoid excessive disk writes
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
          try {
            await saveCache(queryClient);
          } catch (error) {
            console.warn('[QueryProvider] Failed to save cache:', error);
          }
        }, 1000); // 1 second debounce
      }
    });

    window.addEventListener('beforeunload', flushCacheSave);

    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', flushCacheSave);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      flushCacheSave();
    };
  }, [queryClient]);

  if (!isHydrated) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  );
}