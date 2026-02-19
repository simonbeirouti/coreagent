import { NextResponse } from "next/server";

import { getUsersData } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getUsersData();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
