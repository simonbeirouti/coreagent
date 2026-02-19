import "server-only";

type SupabaseConfig = {
  configured: boolean;
  supabaseUrl: string;
  serviceRoleKey: string;
  error?: string;
};

type QueryResult<T> = {
  data: T[];
  error?: string;
};

type MutationResult = {
  error?: string;
};

function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!supabaseUrl) {
    return {
      configured: false,
      supabaseUrl,
      serviceRoleKey,
      error: "Missing NEXT_PUBLIC_SUPABASE_URL",
    };
  }

  if (!serviceRoleKey) {
    return {
      configured: false,
      supabaseUrl,
      serviceRoleKey,
      error: "Missing SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  return { configured: true, supabaseUrl, serviceRoleKey };
}

function buildHeaders(serviceRoleKey: string, extras?: HeadersInit): Headers {
  const headers = new Headers(extras);
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

function tableUrl(table: string, query?: URLSearchParams): string {
  const { supabaseUrl } = getSupabaseConfig();
  const base = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}`;
  if (!query) {
    return base;
  }
  return `${base}?${query.toString()}`;
}

export function getSupabaseConfigError(): string | null {
  const config = getSupabaseConfig();
  return config.error ?? null;
}

export async function fetchRows<T>(
  table: string,
  query: URLSearchParams,
): Promise<QueryResult<T>> {
  const config = getSupabaseConfig();
  if (!config.configured) {
    return { data: [], error: config.error };
  }

  const response = await fetch(tableUrl(table, query), {
    headers: buildHeaders(config.serviceRoleKey),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      data: [],
      error: `Query failed for ${table}: ${response.status} ${text}`,
    };
  }

  const data = (await response.json()) as T[];
  return { data };
}

export async function fetchCount(
  table: string,
  query: URLSearchParams,
): Promise<{ count: number; error?: string }> {
  const config = getSupabaseConfig();
  if (!config.configured) {
    return { count: 0, error: config.error };
  }

  const response = await fetch(tableUrl(table, query), {
    headers: buildHeaders(config.serviceRoleKey, {
      Prefer: "count=exact",
      Range: "0-0",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      count: 0,
      error: `Count failed for ${table}: ${response.status} ${text}`,
    };
  }

  const contentRange = response.headers.get("content-range") ?? "0-0/0";
  const total = Number.parseInt(contentRange.split("/")[1] ?? "0", 10);
  return { count: Number.isFinite(total) ? total : 0 };
}

export async function patchRows(
  table: string,
  match: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<MutationResult> {
  const config = getSupabaseConfig();
  if (!config.configured) {
    return { error: config.error };
  }

  const matchQuery = query(
    Object.fromEntries(Object.entries(match).map(([key, value]) => [key, `eq.${value}`])),
  );

  const response = await fetch(tableUrl(table, matchQuery), {
    method: "PATCH",
    headers: buildHeaders(config.serviceRoleKey, {
      Prefer: "return=minimal",
    }),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      error: `Patch failed for ${table}: ${response.status} ${text}`,
    };
  }

  return {};
}

export function query(params: Record<string, string>): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    qs.set(key, value);
  }
  return qs;
}
