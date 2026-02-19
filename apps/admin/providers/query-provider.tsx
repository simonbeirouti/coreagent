"use client";

import { useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { createQueryClient } from "@/lib/query/query-client";
import { idbPersister } from "@/lib/query/persister";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: 1000 * 60 * 60 * 24,
        buster: "core-admin-v1",
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
