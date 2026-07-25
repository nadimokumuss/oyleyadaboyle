import { computeNetWorth } from "@/lib/valuation";
import { captureIfNewDay } from "@/lib/snapshot";
import { assertAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * SSE akışı: net servet ve fiyatları düzenli aralıkla iter.
 *
 * Polling yerine push kullanmanın sebebi: her istemci tazelemesi
 * sağlayıcı çağrısı tetiklemesin. Sunucu tek merkezden hesaplar,
 * bağlı tüm sekmeler aynı sonucu alır.
 *
 * Aralık 5sn ama cache TTL 60sn — yani her tick sağlayıcıya gitmez,
 * çoğu tick cache'ten döner. Bu, hız limitini korurken arayüzü
 * canlı tutar.
 */
const TICK_MS = 5_000;

export async function GET(request: Request) {
  await assertAuth();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const tick = async () => {
        if (closed) return;
        try {
          const nw = await computeNetWorth();
          // Gün değiştiyse servet eğrisi için anlık görüntü al
          await captureIfNewDay(nw);
          send("networth", {
            totalUsd: nw.totalUsd.toDb(),
            grossAssetsUsd: nw.grossAssetsUsd.toDb(),
            liabilitiesUsd: nw.liabilitiesUsd.toDb(),
            byKind: nw.byKind,
            byCurrency: nw.byCurrency,
            byCountry: nw.byCountry,
            byLiquidity: nw.byLiquidity,
            fxStale: nw.fxStale,
            fxDate: nw.fxDate,
            staleCount: nw.staleCount,
            assetCount: nw.assets.length,
            computedAt: nw.computedAt.toISOString(),
            assets: nw.assets.map((a) => ({
              assetId: a.assetId,
              name: a.name,
              kind: a.kind,
              symbol: a.symbol,
              valueUsd: a.valueUsd.toDb(),
              valueLocal: a.valueLocal.toDb(),
              currency: a.currency,
              basis: a.basis,
              priceAgeMs: a.priceAgeMs,
              changePct24h: a.changePct24h?.toFixed() ?? null,
              unrealizedPnl: a.unrealizedPnl?.toDb() ?? null,
            })),
          });
        } catch (err) {
          send("error", { message: (err as Error).message });
        }
      };

      await tick();
      const interval = setInterval(tick, TICK_MS);

      // Bağlantı koptuğunda interval'i mutlaka temizle — yoksa sunucu
      // kapanan her sekme için sonsuza kadar hesap yapmaya devam eder.
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* zaten kapalı */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
