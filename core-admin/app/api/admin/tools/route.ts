import { NextResponse } from "next/server";

import { getToolsData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getToolsData();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
