import { NextResponse } from "next/server";

import { getJobsData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getJobsData();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
