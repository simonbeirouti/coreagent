import { NextResponse } from "next/server";

import type { AgentState } from "@/lib/admin/types";
import { patchRows } from "@/lib/supabase/rest";

const VALID_STATES: AgentState[] = ["active", "paused", "stopped"];

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;

  let state: AgentState | null = null;

  try {
    const body = (await request.json()) as { state?: string };
    state = VALID_STATES.includes(body.state as AgentState) ? (body.state as AgentState) : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!state) {
    return NextResponse.json({ error: "state must be one of active|paused|stopped" }, { status: 400 });
  }

  const result = await patchRows(
    "agents",
    { id: agentId },
    {
      state,
      updated_at: new Date().toISOString(),
    },
  );

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
}
