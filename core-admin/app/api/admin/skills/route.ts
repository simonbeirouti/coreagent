import { NextResponse } from "next/server";

import { getSkillsData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getSkillsData();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
