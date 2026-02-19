"use client";

import { createStore, del, get, set } from "idb-keyval";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

const store = createStore("core-admin-query", "tanstack-query-cache");
const STORAGE_KEY = "core-admin-query-cache-v1";

export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    await set(STORAGE_KEY, client, store);
  },
  restoreClient: async () => {
    const cached = await get<PersistedClient>(STORAGE_KEY, store);
    return cached ?? undefined;
  },
  removeClient: async () => {
    await del(STORAGE_KEY, store);
  },
};
