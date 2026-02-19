import { NextResponse } from "next/server";

import { getConfigError, getOverviewData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const [overview, configError] = await Promise.all([getOverviewData(), Promise.resolve(getConfigError())]);
  return NextResponse.json({ ...overview, configError }, { headers: { "Cache-Control": "no-store" } });
}
