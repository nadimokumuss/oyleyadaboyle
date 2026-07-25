import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/market/registry";
import { assertAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/quotes?symbols=BTC,ETH,THYAO.IS,AAPL */
export async function GET(request: Request) {
  await assertAuth();
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json(
      { error: "symbols parametresi zorunlu" },
      { status: 400 },
    );
  }
  if (symbols.length > 200) {
    return NextResponse.json(
      { error: "tek çağrıda en fazla 200 sembol" },
      { status: 400 },
    );
  }

  const quotes = await getQuotes(symbols);
  const found = new Set(quotes.map((q) => q.symbol));

  return NextResponse.json({
    quotes,
    /** Hiç fiyatı bulunamayan semboller — arayüz bunları işaretler. */
    missing: symbols
      .map((s) => s.toUpperCase())
      .filter((s) => !found.has(s)),
    asOf: new Date().toISOString(),
  });
}
