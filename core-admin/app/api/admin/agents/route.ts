import { NextResponse } from "next/server";

import { getAgentsData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getAgentsData();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
