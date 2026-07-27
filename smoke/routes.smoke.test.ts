import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/**
 * Rota duman testi.
 *
 * ## Neden var
 *
 * Bir kez, arka plan zamanlayıcısını `instrumentation.ts` üzerinden
 * başlatan bir değişiklik **tüm sayfaları 500'e düşürdü** ve bu commit'e
 * girdi. Ne `npm test` ne `npm run build` yakaladı — ikisi de "başarılı"
 * dedi, çünkü hata ancak bir istek geldiğinde ortaya çıkıyordu.
 *
 * Bu test tam o boşluğu kapatır: uygulamayı gerçekten ayağa kaldırır,
 * gerçek bir oturum açar ve her sayfayı **render ettirir**.
 *
 * ## Neden oturum açıyor
 *
 * Yalnızca 307 (giriş yönlendirmesi) beklemek yetmez: yönlendirme,
 * sayfa bileşeninin hiç çalışmadığı anlamına gelir. Sayfanın içindeki
 * bir hatayı görmek için oturumlu istek şart.
 *
 * ## Neden ayrı komut
 *
 * `npm test` 1,5 saniye sürüyor ve sık çalıştırılıyor; buna sunucu
 * açılışı eklemek o alışkanlığı bozardı. Bu test `npm run test:smoke`
 * ile çalışır.
 */

const ROOT = process.cwd();
const PANEL_DIR = join(ROOT, "app", "(panel)");

/** Kullanılabilir yüksek bir port — çalışan dev sunucusuyla çakışmasın. */
const PORT = 3100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

const dbDir = mkdtempSync(join(tmpdir(), "servet-smoke-"));
const DB_PATH = join(dbDir, "smoke.db");

let server: ChildProcess | null = null;
let sessionCookie = "";

/**
 * `app/(panel)` altındaki tüm sayfaları dosya sisteminden bulur.
 *
 * Elle liste tutmak yerine böyle: yeni bir sayfa eklendiğinde testi
 * güncellemeyi unutursanız o sayfa kapsam dışı kalırdı — oysa asıl
 * yakalanması gereken şey tam da unutulan sayfa.
 *
 * Dinamik segmentler (`[symbol]`) atlanır; onlar örnek veri ister.
 */
function discoverRoutes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("[")) continue;

    const full = join(dir, entry.name);
    if (existsSync(join(full, "page.tsx"))) {
      const rel = relative(PANEL_DIR, full).split(sep).join("/");
      acc.push(`/${rel}`);
    }
    discoverRoutes(full, acc);
  }
  return acc;
}

const PANEL_ROUTES = ["/", ...discoverRoutes(PANEL_DIR).sort()];

/** Oturum gerektirmeyen uçlar. */
const PUBLIC_ROUTES = ["/api/health"];

/** Oturumlu API uçları — sorgu parametresi gerekenler dahil. */
const API_ROUTES = [
  "/api/whoami",
  "/api/export?type=positions",
  "/api/export?type=transactions",
  "/api/export?type=snapshots",
  "/api/export?type=tax",
];

/**
 * Sunucunun kendi hata çıktısı.
 *
 * Açılış başarısız olursa "sunucu açılmadı" demek yetmez — derleme
 * hatasının kendisi gösterilmeli. Bu testi doğuran hata tam olarak
 * burada görünüyordu (`Can't resolve 'fs'`).
 */
const serverErrors: string[] = [];

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(
        `Sunucu süreci ${server.exitCode} koduyla kapandı.\n${lastErrors()}`,
      );
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
      // Yanıt veriyor ama sağlıklı değil: derleme hatası olabilir.
      if (res.status >= 500 && serverErrors.length > 0) {
        throw new Error(
          `Sağlık ucu ${res.status} döndü — uygulama ayağa kalkamadı.\n${lastErrors()}`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Sağlık ucu")) throw err;
      // Aksi halde henüz dinlemiyor demektir; beklemeye devam.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Sunucu ${timeoutMs}ms içinde açılmadı.\n${lastErrors()}`);
}

function lastErrors(): string {
  if (serverErrors.length === 0) return "(sunucudan hata çıktısı gelmedi)";
  return "Sunucu hata çıktısı:\n" + serverErrors.slice(-12).join("");
}

beforeAll(async () => {
  // --- Geçici veritabanını hazırla ---
  //
  // Kullanıcının `data/servet.db` dosyasına asla dokunulmaz.
  process.env.SERVET_DB_PATH = DB_PATH;

  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("@/db/client");
  migrate(db, { migrationsFolder: "./db/migrations" });

  const { settings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { ensureSettingsRow, setPin, createSessionToken, SESSION_COOKIE } =
    await import("@/lib/auth");

  ensureSettingsRow();
  setPin("duman-testi-parolasi");
  db.update(settings)
    .set({ setupCompleted: true })
    .where(eq(settings.id, "singleton"))
    .run();

  // Gerçek imzalı oturum jetonu — sayfalar böylece render edilir.
  sessionCookie = `${SESSION_COOKIE}=${createSessionToken()}`;

  // --- Sunucuyu başlat ---
  //
  // `next dev` kullanılıyor: geliştiricinin gerçekten çalıştırdığı mod bu
  // ve testin doğduğu hata yalnızca burada görünüyordu. `SERVET_PUBLIC`
  // verilmiyor — verilirse çerez `secure` olur ve düz HTTP'de taşınmaz.
  server = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      SERVET_DB_PATH: DB_PATH,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "pipe",
  });

  const capture = (chunk: unknown) => {
    const text = String(chunk);
    if (/error|⨯|Module not found|Unhandled/i.test(text)) serverErrors.push(text);
  };
  server.stderr?.on("data", capture);
  server.stdout?.on("data", capture);

  await waitForServer();
}, 120_000);

afterAll(() => {
  server?.kill("SIGTERM");
  rmSync(dbDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe("rota duman testi", () => {
  it("en az bir sayfa keşfedildi", () => {
    // Keşif bozulursa test sessizce hiçbir şey kontrol etmez hâle gelir.
    expect(PANEL_ROUTES.length).toBeGreaterThan(10);
  });

  it.each(PUBLIC_ROUTES)("%s oturumsuz açılır", async (route) => {
    const res = await fetch(`${BASE}${route}`);
    expect(res.status).toBe(200);
  });

  it.each(PANEL_ROUTES)("%s oturumla render edilir", async (route) => {
    const res = await fetch(`${BASE}${route}`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });

    // 500 = sayfa çalıştı ve patladı. 307 = oturum tanınmadı, yani
    // sayfa hiç çalışmadı — ikisi de başarısızlık.
    expect(
      res.status,
      `${route} → ${res.status}${res.status === 307 ? " (oturum tanınmadı)" : ""}`,
    ).toBe(200);

    const html = await res.text();
    // Next hata sayfası 200 ile de dönebilir; içeriğe de bakılır.
    expect(html).not.toContain("__NEXT_ERROR_CODE");
  }, 30_000);

  it.each(API_ROUTES)("%s oturumla yanıt verir", async (route) => {
    const res = await fetch(`${BASE}${route}`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    expect(res.status, `${route} → ${res.status}`).toBe(200);
  }, 30_000);

  it("oturumsuz istek girişe yönlendirir", async () => {
    // Kapının hâlâ kapalı olduğunu da doğrula: testin oturum kurması,
    // korumanın kalktığı anlamına gelmemeli.
    const res = await fetch(`${BASE}/portfoy`, { redirect: "manual" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/giris");
  });

  it("geçersiz oturum çerezi kabul edilmez", async () => {
    const res = await fetch(`${BASE}/portfoy`, {
      headers: { cookie: "servet_oturum=uydurma-jeton" },
      redirect: "manual",
    });
    expect(res.status).toBe(307);
  });

  it("olmayan sayfa 404 döner", async () => {
    const res = await fetch(`${BASE}/boyle-bir-sayfa-yok`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });
});
