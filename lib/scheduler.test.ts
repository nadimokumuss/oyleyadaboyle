import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Zamanlayıcı ve tekrarlayan hareket testleri — **gerçek veritabanına karşı**.
 *
 * Bu faz para hareketi üretiyor; saf fonksiyon testi yetmez. Asıl soru
 * "aynı iş iki kez çalışırsa ne olur" ve bunun cevabı ancak SQLite'ın
 * benzersizlik kısıtıyla birlikte anlamlı.
 *
 * Her çalıştırma geçici bir dosyada kendi veritabanını kurar; kullanıcının
 * `data/servet.db` dosyasına asla dokunulmaz.
 */

const dir = mkdtempSync(join(tmpdir(), "servet-test-"));
process.env.SERVET_DB_PATH = join(dir, "test.db");

// Modüller `SERVET_DB_PATH` ayarlandıktan SONRA yüklenmeli — db/client
// yolu import anında okuyor.
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let scheduler: typeof import("@/lib/scheduler");
let recurring: typeof import("@/lib/services/recurring");
let notify: typeof import("@/lib/services/notify");
let autopay: typeof import("@/lib/services/loanAutopay");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("@/db/client");
  db = client.db;
  migrate(db, { migrationsFolder: "./db/migrations" });

  schema = await import("@/db/schema");
  scheduler = await import("@/lib/scheduler");
  recurring = await import("@/lib/services/recurring");
  notify = await import("@/lib/services/notify");
  autopay = await import("@/lib/services/loanAutopay");
});

beforeEach(() => {
  db.delete(schema.transactions).run();
  db.delete(schema.recurringTransactions).run();
  db.delete(schema.jobRuns).run();
  db.delete(schema.notifications).run();
  db.delete(schema.liabilities).run();
  db.delete(schema.assets).run();
});

function makeCashAsset(id = "cash-1") {
  db.insert(schema.assets)
    .values({
      id,
      kind: "cash",
      name: "Test hesabı",
      currency: "USD",
      country: "TR",
      status: "active",
      liquidity: "instant",
    })
    .run();
  return id;
}

function txCount(): number {
  return db.select().from(schema.transactions).all().length;
}

/* ------------------------------------------------------------------ */

describe("runJob — idempotency defteri", () => {
  const makeJob = (counter: { n: number }): import("@/lib/scheduler").Job => ({
    key: "test",
    label: "Test",
    runKeyFor: scheduler.dayKey,
    async run() {
      counter.n++;
      return `çalıştı ${counter.n}`;
    },
  });

  it("aynı gün ikinci kez çalışmaz", async () => {
    const counter = { n: 0 };
    const job = makeJob(counter);
    const now = new Date("2026-07-27T10:00:00");

    await scheduler.runJob(job, now);
    await scheduler.runJob(job, now);
    await scheduler.runJob(job, new Date("2026-07-27T23:59:00"));

    expect(counter.n).toBe(1);
  });

  it("ertesi gün yeniden çalışır", async () => {
    const counter = { n: 0 };
    const job = makeJob(counter);

    await scheduler.runJob(job, new Date("2026-07-27T10:00:00"));
    await scheduler.runJob(job, new Date("2026-07-28T10:00:00"));

    expect(counter.n).toBe(2);
  });

  it("dönemi gelmemiş iş atlanır", async () => {
    let ran = false;
    await scheduler.runJob(
      { key: "hiç", label: "Hiç", runKeyFor: () => null, async run() { ran = true; return ""; } },
      new Date(),
    );
    expect(ran).toBe(false);
  });

  it("hata veren iş rezervasyonu bırakır — sonraki tur tekrar dener", async () => {
    let attempts = 0;
    const flaky: import("@/lib/scheduler").Job = {
      key: "flaky",
      label: "Kırılgan",
      runKeyFor: scheduler.dayKey,
      async run() {
        attempts++;
        if (attempts === 1) throw new Error("geçici ağ hatası");
        return "ikinci denemede oldu";
      },
    };
    const now = new Date("2026-07-27T10:00:00");

    await scheduler.runJob(flaky, now);
    expect(scheduler.hasRun("flaky", "2026-07-27")).toBe(false);

    await scheduler.runJob(flaky, now);
    expect(attempts).toBe(2);
    expect(scheduler.hasRun("flaky", "2026-07-27")).toBe(true);
  });

  it("bir iş patlarsa diğerleri çalışmaya devam eder", async () => {
    let ok = 0;
    await scheduler.runDueJobs(
      [
        { key: "patlak", label: "P", runKeyFor: scheduler.dayKey, async run() { throw new Error("x"); } },
        { key: "saglam", label: "S", runKeyFor: scheduler.dayKey, async run() { ok++; return "ok"; } },
      ],
      new Date("2026-07-27T10:00:00"),
    );
    expect(ok).toBe(1);
  });
});

/* ------------------------------------------------------------------ */

describe("runDueRecurring — çift kayıt üretmez", () => {
  function makeTemplate(overrides: Partial<typeof schema.recurringTransactions.$inferInsert> = {}) {
    const assetId = makeCashAsset();
    db.insert(schema.recurringTransactions)
      .values({
        id: "rec-1",
        assetId,
        label: "Maaş",
        type: "deposit_in",
        amount: "5000",
        currency: "USD",
        frequency: "monthly",
        startDate: "2026-01-15",
        nextRunDate: "2026-01-15",
        active: true,
        ...overrides,
      })
      .run();
  }

  it("aynı gün iki kez çağrılsa da tek kayıt üretir", () => {
    makeTemplate();
    const now = new Date("2026-01-15T12:00:00");

    recurring.runDueRecurring(now);
    expect(txCount()).toBe(1);

    recurring.runDueRecurring(now);
    expect(txCount()).toBe(1);
  });

  it("geçmiş dönemleri toplu telafi eder, atlamaz", () => {
    makeTemplate();
    // Beş ay panel açılmamış: Ocak–Mayıs arası beş kayıt beklenir.
    recurring.runDueRecurring(new Date("2026-05-20T12:00:00"));
    expect(txCount()).toBe(5);

    const dates = db
      .select({ date: schema.transactions.date })
      .from(schema.transactions)
      .all()
      .map((t) => t.date)
      .sort();
    expect(dates).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15",
    ]);
  });

  it("telafiden sonra tekrar çağrılınca yeni kayıt üretmez", () => {
    makeTemplate();
    recurring.runDueRecurring(new Date("2026-05-20T12:00:00"));
    recurring.runDueRecurring(new Date("2026-05-20T12:00:00"));
    expect(txCount()).toBe(5);
  });

  it("vadesi gelmemiş şablona dokunmaz", () => {
    makeTemplate({ startDate: "2026-09-01", nextRunDate: "2026-09-01" });
    recurring.runDueRecurring(new Date("2026-05-20T12:00:00"));
    expect(txCount()).toBe(0);
  });

  it("pasif şablon çalışmaz", () => {
    makeTemplate({ active: false });
    recurring.runDueRecurring(new Date("2026-05-20T12:00:00"));
    expect(txCount()).toBe(0);
  });

  it("bitiş tarihi geçince şablon kapanır", () => {
    makeTemplate({ endDate: "2026-03-01" });
    recurring.runDueRecurring(new Date("2026-06-20T12:00:00"));

    // Ocak ve Şubat üretilir, Mart 15 bitişi aştığı için durur.
    expect(txCount()).toBe(2);
    const row = db
      .select()
      .from(schema.recurringTransactions)
      .all()[0];
    expect(row.active).toBe(false);
  });

  it("üretilen kayıt normal bir işlem — geri alınabilir", () => {
    makeTemplate();
    recurring.runDueRecurring(new Date("2026-01-15T12:00:00"));

    const tx = db.select().from(schema.transactions).all()[0];
    expect(tx.type).toBe("deposit_in");
    expect(tx.amount).toBe("5000");
    expect(tx.note).toContain("otomatik");
    // İşlemler sayfasındaki geri alma bu satırı silebilmeli.
    expect(tx.id).toBeTruthy();
  });

  it("nextRunDate ilerler ve çapaya sadık kalır", () => {
    makeTemplate({ startDate: "2026-01-31", nextRunDate: "2026-01-31" });
    recurring.runDueRecurring(new Date("2026-04-05T12:00:00"));

    const dates = db
      .select({ date: schema.transactions.date })
      .from(schema.transactions)
      .all()
      .map((t) => t.date)
      .sort();
    // Şubat kısa diye 28'e düşer ama Mart yine 31 olur.
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

/* ------------------------------------------------------------------ */

describe("runLoanAutopay — kredi taksitleri", () => {
  function makeLoan(overrides: Partial<typeof schema.liabilities.$inferInsert> = {}) {
    const cashId = makeCashAsset("cash-loan");
    db.insert(schema.liabilities)
      .values({
        id: "loan-1",
        name: "Konut kredisi",
        currency: "USD",
        principal: "120000",
        annualRate: "0.12",
        termMonths: 120,
        startDate: "2026-01-10",
        paymentsMade: 0,
        status: "active",
        autoPay: true,
        paymentAssetId: cashId,
        ...overrides,
      })
      .run();
    return cashId;
  }

  function loanRow() {
    return db.select().from(schema.liabilities).all()[0];
  }

  it("autoPay kapalıysa hiçbir şey yapmaz", () => {
    makeLoan({ autoPay: false });
    const r = autopay.runLoanAutopay(new Date("2026-06-15T12:00:00"));
    expect(r.processed).toBe(0);
    expect(txCount()).toBe(0);
    expect(loanRow().paymentsMade).toBe(0);
  });

  it("ilk çalıştırma geçmişi para hareketiyle canlandırmaz, sayacı eşitler", () => {
    makeLoan();
    const r = autopay.runLoanAutopay(new Date("2026-06-15T12:00:00"));

    expect(r.baselined).toBe(1);
    expect(r.installments).toBe(0);
    // Beş ay geçmiş ama nakitten beş taksit düşülmedi — o taksitler
    // gerçekte zaten ödenmişti, panel sadece bilmiyordu.
    expect(txCount()).toBe(0);
    expect(loanRow().paymentsMade).toBeGreaterThan(1);
  });

  it("referans alındıktan sonraki taksit nakitten düşer", () => {
    // 2026-01-10 başlangıçlı kredide 2026-06-15 itibarıyla 5 taksit
    // beklenir; sayaç 2'de olduğu için 3 taksit işlenmeli.
    makeLoan({ paymentsMade: 2 });
    const r = autopay.runLoanAutopay(new Date("2026-06-15T12:00:00"));

    expect(r.installments).toBe(3);
    expect(txCount()).toBe(3);
    expect(loanRow().paymentsMade).toBe(5);

    const tx = db.select().from(schema.transactions).all()[0];
    expect(tx.type).toBe("withdraw");
    expect(tx.assetId).toBe("cash-loan");
    expect(tx.note).toContain("taksit");
  });

  it("aynı gün iki kez çalışsa da çift taksit düşmez", () => {
    makeLoan({ paymentsMade: 2 });
    const now = new Date("2026-06-15T12:00:00");

    autopay.runLoanAutopay(now);
    const after = txCount();
    autopay.runLoanAutopay(now);

    expect(txCount()).toBe(after);
  });

  it("nakit hesabı seçilmemişse sayaç ilerler ama para hareketi yazılmaz", () => {
    makeLoan({ paymentsMade: 2, paymentAssetId: null });
    autopay.runLoanAutopay(new Date("2026-06-15T12:00:00"));

    expect(txCount()).toBe(0);
    expect(loanRow().paymentsMade).toBe(5);
  });

  it("vade dolunca kredi kapanır", () => {
    makeLoan({ termMonths: 3, paymentsMade: 1 });
    autopay.runLoanAutopay(new Date("2027-06-15T12:00:00"));

    const row = loanRow();
    expect(row.paymentsMade).toBe(3);
    expect(row.status).toBe("paid");
  });

  it("taksit sayısı vadeyi aşmaz", () => {
    makeLoan({ termMonths: 6, paymentsMade: 1 });
    autopay.runLoanAutopay(new Date("2030-01-01T12:00:00"));
    expect(loanRow().paymentsMade).toBe(6);
  });
});

/* ------------------------------------------------------------------ */

describe("notify — bildirim kaydı", () => {
  it("dedupe anahtarı tekrarı engeller", () => {
    const first = notify.record({ kind: "system", title: "Test", dedupeKey: "a" });
    const second = notify.record({ kind: "system", title: "Test", dedupeKey: "a" });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(notify.recent().length).toBe(1);
  });

  it("dedupe anahtarı olmayanlar çoğalabilir", () => {
    notify.record({ kind: "system", title: "A" });
    notify.record({ kind: "system", title: "B" });
    expect(notify.recent().length).toBe(2);
  });

  it("webhook tanımsızsa gönderim sessizce atlanır", async () => {
    notify.record({ kind: "system", title: "Bekleyen" });
    await expect(notify.flushPending()).resolves.toBe(0);
  });

  it("okunmamış sayısı doğru", () => {
    notify.record({ kind: "system", title: "A" });
    notify.record({ kind: "system", title: "B" });
    expect(notify.unreadCount()).toBe(2);
    notify.markAllRead();
    expect(notify.unreadCount()).toBe(0);
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
