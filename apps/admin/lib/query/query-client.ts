"use client";

import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 1000 * 60 * 60 * 24,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
        networkMode: "offlineFirst",
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: 1,
      },
    },
  });
}
