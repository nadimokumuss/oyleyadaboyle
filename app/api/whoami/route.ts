import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { assertAuth } from "@/lib/session";
import { clientIp } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Bağlantı IP'sini döner — IP kısıtlaması kurarken kendini kilitlememek için. */
export async function GET() {
  await assertAuth();
  const h = await headers();
  return NextResponse.json({ ip: clientIp(h) });
}
