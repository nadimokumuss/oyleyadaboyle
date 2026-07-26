import { randomUUID } from "node:crypto";
import { db } from "./client";
import {
  accounts, assets, transactions, deposits, properties, vehicles, ventures,
  settings, targets, withholdingRates,
} from "./schema";

/**
 * Demo senaryo: 29 yaşında, Türkiye'de yaşayan, 10 milyon doları olan
 * ve sıfırdan hayat kuran biri.
 *
 * Amaç panelin her modülünü gerçekçi verilerle doldurmak — sayılar
 * temsilîdir, yatırım önerisi değildir.
 */

const id = () => randomUUID();
const now = new Date().toISOString();

/**
 * GÜVENLİK KAPISI
 *
 * Bu betik tüm verinizi siler. Yanlışlıkla çalıştırılması gerçek bir
 * kayba yol açtığı için artık iki koşul gerekiyor:
 *
 *   1. Veritabanı boş olmalı, VEYA
 *   2. `--force` bayrağı verilmiş olmalı
 *
 * Dolu bir veritabanına yanlışlıkla demo yüklemek artık mümkün değil.
 */
function guard(): void {
  const existing = db.select().from(assets).all();
  const force = process.argv.includes("--force");

  if (existing.length === 0) return;

  if (!force) {
    console.error(
      `\n✗ Veritabanında ${existing.length} varlık var ve bu betik hepsini siler.\n` +
        `\n  Verilerinizi kaybetmeden önce yedek alın:\n` +
        `    cp data/servet.db "yedek-$(date +%F).db"\n` +
        `\n  Yine de demo yüklemek istiyorsanız:\n` +
        `    npm run db:seed -- --force\n`,
    );
    process.exit(1);
  }

  console.warn(
    `⚠ --force verildi: ${existing.length} varlık siliniyor.\n`,
  );
}

function reset() {
  // Sıra önemli: yabancı anahtar kısıtları yüzünden çocuklar önce
  db.delete(transactions).run();
  db.delete(deposits).run();
  db.delete(properties).run();
  db.delete(vehicles).run();
  db.delete(ventures).run();
  db.delete(assets).run();
  db.delete(accounts).run();
  db.delete(targets).run();
  db.delete(withholdingRates).run();
  db.delete(settings).run();
}

/**
 * Demo alımlarının finansmanı.
 *
 * Panelin temel kuralı "her varlık ya nakitten ya krediden gelir".
 * Demo bunu ihlal ederse, kullanıcı panele girer girmez tutarsız bir
 * tablo görür ve denetim uyarı verir. Bu yüzden demo da kurala uyar:
 * önce para birimi başına nakit hesabı açılır, sonra her alım oradan
 * düşülür.
 */
const purchases: Array<{ assetId: string; amount: string; currency: string }> = [];

function fund(assetId: string, amount: string, currency: string): void {
  purchases.push({ assetId, amount, currency });
}

/** Alımları karşılayacak nakit hesaplarını açar ve çıkışları yazar. */
function createFundingAccounts(accountByCurrency: Record<string, string>): void {
  const totals = new Map<string, number>();
  for (const p of purchases) {
    totals.set(p.currency, (totals.get(p.currency) ?? 0) + Number(p.amount));
  }

  const cashAssetByCurrency = new Map<string, string>();

  for (const [currency, spent] of totals) {
    // Alımlardan sonra bir miktar serbest nakit kalsın — fırsat
    // motorunun "atıl nakit" kuralı da böylece görünür olur
    const leftover = currency === "USD" ? 620_000 : spent * 0.05;
    const cashId = id();
    cashAssetByCurrency.set(currency, cashId);

    db.insert(assets).values({
      id: cashId,
      kind: "cash",
      name: `Serbest Nakit (${currency})`,
      symbol: null,
      accountId: accountByCurrency[currency] ?? null,
      currency,
      country: "TR",
      status: "active",
      liquidity: "instant",
      tags: [],
      note: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    db.insert(transactions).values({
      id: id(),
      assetId: cashId,
      type: "deposit_in",
      date: "2026-01-02",
      quantity: null,
      pricePerUnit: null,
      amount: String(Math.round(spent + leftover)),
      currency,
      fxRateToUsd: currency === "USD" ? "1" : null,
      fee: null,
      note: "Başlangıç sermayesi",
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  // Her alım için nakit çıkışı
  for (const p of purchases) {
    const cashId = cashAssetByCurrency.get(p.currency);
    if (!cashId) continue;

    db.insert(transactions).values({
      id: id(),
      assetId: cashId,
      type: "withdraw",
      date: "2026-01-03",
      quantity: null,
      pricePerUnit: null,
      amount: p.amount,
      currency: p.currency,
      fxRateToUsd: p.currency === "USD" ? "1" : null,
      fee: null,
      // applyFunding ile aynı biçim — denetim bunu "finanse edilmiş" sayar
      note: `FUNDING:${p.assetId}`,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}

function seed() {
  guard();
  reset();

  /* --- Ayarlar --- */
  db.insert(settings).values({
    id: "singleton",
    baseCurrency: "USD",
    locale: "tr-TR",
    monthlyLivingCost: "8000",
    livingCostCurrency: "USD",
    riskProfile: "balanced",
    idleCashThreshold: "250000",
    concentrationThreshold: "0.25",
    createdAt: now,
    updatedAt: now,
  }).run();

  /* --- Stopaj oranları (TR mevduat, vadeye göre kademeli) --- */
  db.insert(withholdingRates).values([
    { id: id(), currency: "TRY", maxTermDays: 180, rate: "0.15", effectiveFrom: "2025-01-01", note: "6 aya kadar TL vadeli" },
    { id: id(), currency: "TRY", maxTermDays: 365, rate: "0.12", effectiveFrom: "2025-01-01", note: "1 yıla kadar TL vadeli" },
    { id: id(), currency: "TRY", maxTermDays: null, rate: "0.10", effectiveFrom: "2025-01-01", note: "1 yıl üzeri TL vadeli" },
    { id: id(), currency: "USD", maxTermDays: null, rate: "0.25", effectiveFrom: "2025-01-01", note: "Döviz mevduat" },
    { id: id(), currency: "EUR", maxTermDays: null, rate: "0.25", effectiveFrom: "2025-01-01", note: "Döviz mevduat" },
  ]).run();

  /* --- Hesaplar --- */
  const accGaranti = id();
  const accIbkr = id();
  const accBinance = id();
  const accCash = id();

  db.insert(accounts).values([
    { id: accGaranti, institution: "Garanti BBVA", country: "TR", type: "bank", currency: "TRY", note: "Ana TL hesabı", createdAt: now, updatedAt: now },
    { id: accIbkr, institution: "Interactive Brokers", country: "US", type: "broker", currency: "USD", note: "Global hisse", createdAt: now, updatedAt: now },
    { id: accBinance, institution: "Binance", country: "MT", type: "wallet", currency: "USD", note: "Kripto", createdAt: now, updatedAt: now },
    { id: accCash, institution: "Nakit", country: "TR", type: "cash", currency: "USD", note: "Serbest nakit", createdAt: now, updatedAt: now },
  ]).run();

  /* --- Piyasa pozisyonları --- */
  const market = [
    { name: "Bitcoin", symbol: "BTC", kind: "crypto" as const, acc: accBinance, qty: "18", cost: "1150000", date: "2026-02-10", country: null, liq: "instant" as const },
    { name: "Ethereum", symbol: "ETH", kind: "crypto" as const, acc: accBinance, qty: "250", cost: "480000", date: "2026-02-12", country: null, liq: "instant" as const },
    { name: "Apple", symbol: "AAPL", kind: "equity" as const, acc: accIbkr, qty: "1200", cost: "290000", date: "2026-03-02", country: "US", liq: "days" as const },
    { name: "Vanguard S&P 500 ETF", symbol: "VOO", kind: "equity" as const, acc: accIbkr, qty: "1800", cost: "980000", date: "2026-03-05", country: "US", liq: "days" as const },
    { name: "Türk Hava Yolları", symbol: "THYAO.IS", kind: "equity" as const, acc: accGaranti, qty: "40000", cost: "11200000", date: "2026-04-01", country: "TR", liq: "days" as const, currency: "TRY" },
    { name: "BIM Mağazalar", symbol: "BIMAS.IS", kind: "equity" as const, acc: accGaranti, qty: "25000", cost: "13500000", date: "2026-04-03", country: "TR", liq: "days" as const, currency: "TRY" },
  ];

  for (const m of market) {
    const assetId = id();
    const currency = m.currency ?? "USD";
    db.insert(assets).values({
      id: assetId, kind: m.kind, name: m.name, symbol: m.symbol,
      accountId: m.acc, currency, country: m.country, status: "active",
      liquidity: m.liq, tags: [], note: null, createdAt: now, updatedAt: now,
    }).run();
    db.insert(transactions).values({
      id: id(), assetId, type: "buy", date: m.date,
      quantity: m.qty, pricePerUnit: null, amount: m.cost, currency,
      fxRateToUsd: null, fee: null, note: "İlk alım", createdAt: now, updatedAt: now,
    }).run();
    fund(assetId, m.cost, currency);
  }

  /* --- Mevduat --- */
  const depositsData = [
    { name: "Garanti TL Vadeli", acc: accGaranti, currency: "TRY", principal: "100000000", rate: "0.42", start: "2026-06-15", maturity: "2026-09-15", comp: "simple" as const },
    { name: "Garanti USD Vadeli", acc: accGaranti, currency: "USD", principal: "1500000", rate: "0.035", start: "2026-05-01", maturity: "2027-05-01", comp: "monthly" as const },
  ];

  for (const d of depositsData) {
    const assetId = id();
    db.insert(assets).values({
      id: assetId, kind: "deposit", name: d.name, symbol: null,
      accountId: d.acc, currency: d.currency, country: "TR", status: "active",
      liquidity: "months", tags: [], note: null, createdAt: now, updatedAt: now,
    }).run();
    db.insert(deposits).values({
      assetId, principal: d.principal, annualRate: d.rate,
      compounding: d.comp, dayCount: "ACT/365",
      startDate: d.start, maturityDate: d.maturity,
      withholdingRateOverride: null, autoRenew: false,
    }).run();
    fund(assetId, d.principal, d.currency);
  }

  /* --- Gayrimenkul --- */
  const props = [
    { name: "İstanbul Etiler Daire", city: "İstanbul", country: "TR", currency: "TRY", price: "42000000", date: "2026-03-20", rent: "165000", indexKey: "TR-IST-HPI", lat: 41.0810, lng: 29.0340 },
    { name: "Lizbon Dairesi", city: "Lizbon", country: "PT", currency: "EUR", price: "620000", date: "2026-05-10", rent: "2400", indexKey: "PT-LIS-HPI", lat: 38.7223, lng: -9.1393 },
    { name: "Dubai Marina Dairesi", city: "Dubai", country: "AE", currency: "USD", price: "780000", date: "2026-06-01", rent: "5200", indexKey: "AE-DXB-HPI", lat: 25.0805, lng: 55.1403 },
  ];

  for (const p of props) {
    const assetId = id();
    db.insert(assets).values({
      id: assetId, kind: "realestate", name: p.name, symbol: null,
      accountId: null, currency: p.currency, country: p.country, status: "active",
      liquidity: "months", tags: [], note: null, createdAt: now, updatedAt: now,
    }).run();
    db.insert(properties).values({
      assetId, addressLine: null, city: p.city, country: p.country,
      lat: p.lat, lng: p.lng,
      purchasePrice: p.price, purchaseDate: p.date,
      closingCosts: String(Math.round(Number(p.price) * 0.04)),
      renovationCost: "0",
      indexKey: p.indexKey, manualValue: null, manualValueDate: null,
      monthlyRent: p.rent, occupancyRate: "0.92",
      monthlyCosts: { hoa: String(Math.round(Number(p.rent) * 0.08)), tax: String(Math.round(Number(p.rent) * 0.05)) },
    }).run();
    fund(assetId, String(Math.round(Number(p.price) * 1.04)), p.currency);
  }

  /* --- Araçlar --- */
  const cars = [
    { name: "Porsche 911 Carrera", make: "Porsche", model: "911 Carrera", year: 2026, country: "TR", currency: "TRY", price: "18500000", date: "2026-04-15", segment: "luxury" },
    { name: "Toyota Corolla Hybrid", make: "Toyota", model: "Corolla Hybrid", year: 2026, country: "TR", currency: "TRY", price: "2100000", date: "2026-04-20", segment: "economy" },
  ];

  for (const c of cars) {
    const assetId = id();
    db.insert(assets).values({
      id: assetId, kind: "vehicle", name: c.name, symbol: null,
      accountId: null, currency: c.currency, country: c.country, status: "active",
      liquidity: "weeks", tags: [], note: null, createdAt: now, updatedAt: now,
    }).run();
    db.insert(vehicles).values({
      assetId, make: c.make, model: c.model, year: c.year, odometer: 3500,
      country: c.country, segment: c.segment,
      purchasePrice: c.price, purchaseDate: c.date,
      manualValue: null, manualValueDate: null,
      annualCosts: {
        insurance: String(Math.round(Number(c.price) * 0.02)),
        tax: String(Math.round(Number(c.price) * 0.01)),
        maintenance: String(Math.round(Number(c.price) * 0.015)),
        fuel: String(Math.round(Number(c.price) * 0.008)),
      },
    }).run();
    fund(assetId, c.price, c.currency);
  }

  /* --- Girişimler --- */
  const startups = [
    { name: "Lojistik SaaS", legal: "Rota Teknoloji A.Ş.", country: "TR", currency: "USD", committed: "1200000", called: "450000", own: "0.65", val: "4000000", rev: "38000", burn: "95000", cash: "380000", stage: "seed", sector: "SaaS" },
    { name: "Kahve Zinciri", legal: "Demlik Gıda A.Ş.", country: "TR", currency: "USD", committed: "600000", called: "600000", own: "0.80", val: "1400000", rev: "72000", burn: "68000", cash: "145000", stage: "pre-seed", sector: "F&B" },
  ];

  for (const s of startups) {
    const assetId = id();
    db.insert(assets).values({
      id: assetId, kind: "venture", name: s.name, symbol: null,
      accountId: null, currency: s.currency, country: s.country, status: "active",
      liquidity: "illiquid", tags: [], note: null, createdAt: now, updatedAt: now,
    }).run();
    db.insert(ventures).values({
      assetId, legalName: s.legal, country: s.country, sector: s.sector,
      ownershipPct: s.own, committedCapital: s.committed, calledCapital: s.called,
      valuation: s.val, valuationDate: "2026-06-01",
      monthlyRevenue: s.rev, monthlyBurn: s.burn, cashOnHand: s.cash,
      stage: s.stage,
    }).run();
    fund(assetId, s.called, s.currency);
  }

  /* --- Nakit hesapları ve alımların finansmanı --- */
  createFundingAccounts({ TRY: accGaranti, USD: accCash, EUR: accCash });

  /* --- Hedef dağılım (yeniden dengeleme kuralı için) --- */
  db.insert(targets).values([
    { id: id(), dimension: "kind", key: "equity", targetPct: "0.30", tolerancePct: "0.05" },
    { id: id(), dimension: "kind", key: "crypto", targetPct: "0.15", tolerancePct: "0.05" },
    { id: id(), dimension: "kind", key: "realestate", targetPct: "0.25", tolerancePct: "0.05" },
    { id: id(), dimension: "kind", key: "deposit", targetPct: "0.20", tolerancePct: "0.05" },
    { id: id(), dimension: "kind", key: "venture", targetPct: "0.10", tolerancePct: "0.05" },
  ]).run();

  const count = db.select({ id: assets.id }).from(assets).all().length;
  console.log(`✓ Demo senaryo yüklendi: ${count} varlık`);
  console.log("  npm run dev → http://localhost:3000");
}

seed();
