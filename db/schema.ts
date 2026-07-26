import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Şema notları
 *
 * - TÜM para alanları TEXT (ondalık string). REAL kullanılmaz: IEEE754
 *   float para için güvenli değil. lib/money.ts okurken Money.fromDb ile
 *   Decimal'a çevirir.
 * - Hiçbir yerde "güncel bakiye" saklanmaz. Bakiye = transactions'ın
 *   türevi, değer = bakiye × canlı fiyat. Böylece veri kendisiyle
 *   çelişemez. Tek istisna holdings_cache, ve o da adı üstünde cache —
 *   her an silinip transactions'tan yeniden üretilebilir.
 * - Tarihler ISO 8601 string (YYYY-MM-DD veya tam ISO timestamp).
 *   SQLite'ta doğal sıralanır, TZ belirsizliği yaratmaz.
 */

const id = () => text("id").primaryKey();
const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
};

/* ------------------------------------------------------------------ */
/* Hesaplar ve varlıklar                                               */
/* ------------------------------------------------------------------ */

export const accounts = sqliteTable("accounts", {
  id: id(),
  institution: text("institution").notNull(), // "Garanti BBVA", "Interactive Brokers"
  country: text("country").notNull(), // ISO 3166-1 alpha-2: "TR", "US"
  type: text("type", { enum: ["bank", "broker", "wallet", "cash", "other"] }).notNull(),
  currency: text("currency").notNull(),
  note: text("note"),
  ...timestamps,
});

/** Tüm varlık türlerinin ortak üst tablosu. Alt tablolar 1-1 uzantı. */
export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    kind: text("kind", {
      enum: ["equity", "crypto", "deposit", "realestate", "vehicle", "venture", "cash", "commodity"],
    }).notNull(),
    name: text("name").notNull(),
    symbol: text("symbol"), // piyasa varlıkları için: "BTC", "THYAO.IS", "AAPL"
    accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
    currency: text("currency").notNull(), // varlığın YEREL para birimi
    country: text("country"),
    /**
     * planned = almayı düşündüğünüz, henüz sahip olmadığınız varlık.
     * Net servete DAHİL EDİLMEZ; /plan sayfasında ayrı değerlendirilir.
     */
    status: text("status", { enum: ["active", "planned", "sold", "closed"] })
      .notNull()
      .default("active"),
    /** Likidite merdiveni için: nakde çevirme süresi. */
    liquidity: text("liquidity", { enum: ["instant", "days", "weeks", "months", "illiquid"] })
      .notNull()
      .default("days"),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    note: text("note"),
    ...timestamps,
  },
  (t) => [index("assets_kind_idx").on(t.kind), index("assets_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/* İşlemler — tek gerçek kaynak                                        */
/* ------------------------------------------------------------------ */

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "buy", "sell",
        "dividend", "interest", "rent", "staking",
        "expense", "fee", "tax",
        "deposit_in", "withdraw",
        "capital_call", "distribution",
        "valuation", // değerleme güncellemesi (nakit akışı yok)
      ],
    }).notNull(),
    date: text("date").notNull(), // ISO
    quantity: text("quantity"), // adet/lot/koin — para değil
    pricePerUnit: text("price_per_unit"),
    amount: text("amount").notNull(), // işlemin toplam tutarı
    currency: text("currency").notNull(),
    /** İşlem anındaki 1 birim `currency` = kaç USD. Geçmişi dondurur. */
    fxRateToUsd: text("fx_rate_to_usd"),
    fee: text("fee"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("tx_asset_idx").on(t.assetId),
    index("tx_date_idx").on(t.date),
    index("tx_type_idx").on(t.type),
  ],
);

/*
 * Not: eskiden burada bir `holdings_cache` tablosu vardı — transactions'tan
 * türetilmiş bir önbellek. Hiç okunmadı ve hiç yazılmadı: miktar, ağırlıklı
 * ortalama maliyet ve FIFO lot'ları her istekte
 * lib/finance/costbasis.ts:computePosition ile işlemlerden yeniden
 * hesaplanıyor. Önbellek olmadan da yeterince hızlı olduğu için tablo
 * düşürüldü; geçmişte kalan boş tabloyu silmek de bir göç gerektirdi.
 */

/* ------------------------------------------------------------------ */
/* Varlık türü uzantıları                                              */
/* ------------------------------------------------------------------ */

export const deposits = sqliteTable("deposits", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  principal: text("principal").notNull(),
  annualRate: text("annual_rate").notNull(), // 0.45 = %45 brüt yıllık
  compounding: text("compounding", {
    enum: ["simple", "daily", "monthly", "quarterly", "annual", "continuous"],
  })
    .notNull()
    .default("simple"),
  dayCount: text("day_count", { enum: ["ACT/365", "ACT/360", "30/360"] })
    .notNull()
    .default("ACT/365"),
  startDate: text("start_date").notNull(),
  maturityDate: text("maturity_date"), // null = vadesiz
  /** null ise stopaj tablosundan otomatik hesaplanır. */
  withholdingRateOverride: text("withholding_rate_override"),
  autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
});

export const properties = sqliteTable("properties", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  addressLine: text("address_line"),
  city: text("city").notNull(),
  country: text("country").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  purchasePrice: text("purchase_price").notNull(),
  purchaseDate: text("purchase_date").notNull(),
  closingCosts: text("closing_costs").default("0"), // tapu, komisyon, vergi
  renovationCost: text("renovation_cost").default("0"),
  /** index_series'e bağlanır: "TR-IST", "US-NATIONAL", "DE-BER" */
  indexKey: text("index_key"),
  /** Elle girilen ekspertiz. Girilirse bu tarihten sonrası buradan endekslenir. */
  manualValue: text("manual_value"),
  manualValueDate: text("manual_value_date"),
  monthlyRent: text("monthly_rent").default("0"),
  occupancyRate: text("occupancy_rate").default("1"), // 0-1
  monthlyCosts: text("monthly_costs", { mode: "json" })
    .$type<{ hoa?: string; tax?: string; insurance?: string; maintenance?: string }>()
    .default({}),
});

export const vehicles = sqliteTable("vehicles", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  odometer: integer("odometer").default(0), // km
  country: text("country").notNull(),
  /** depreciation.json anahtarı: "luxury", "mid", "economy", "classic", "ev" */
  segment: text("segment").notNull().default("mid"),
  purchasePrice: text("purchase_price").notNull(),
  purchaseDate: text("purchase_date").notNull(),
  manualValue: text("manual_value"),
  manualValueDate: text("manual_value_date"),
  annualCosts: text("annual_costs", { mode: "json" })
    .$type<{ insurance?: string; tax?: string; maintenance?: string; fuel?: string }>()
    .default({}),
});

export const ventures = sqliteTable("ventures", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  legalName: text("legal_name").notNull(),
  country: text("country").notNull(),
  sector: text("sector"),
  ownershipPct: text("ownership_pct").notNull(), // 0-1
  committedCapital: text("committed_capital").notNull(),
  calledCapital: text("called_capital").notNull().default("0"),
  valuation: text("valuation"), // son tur değerlemesi
  valuationDate: text("valuation_date"),
  monthlyRevenue: text("monthly_revenue").default("0"),
  monthlyBurn: text("monthly_burn").default("0"),
  cashOnHand: text("cash_on_hand").default("0"),
  stage: text("stage"), // "pre-seed", "seed", "A", ...
});

/* ------------------------------------------------------------------ */
/* Piyasa verisi cache                                                 */
/* ------------------------------------------------------------------ */

export const priceCache = sqliteTable("price_cache", {
  symbol: text("symbol").primaryKey(),
  price: text("price").notNull(),
  currency: text("currency").notNull(),
  changePct24h: text("change_pct_24h"),
  source: text("source").notNull(), // "coingecko" | "yahoo" | "frankfurter"
  fetchedAt: text("fetched_at").notNull(),
  /** true ise sağlayıcı ulaşılamadı, bu son bilinen fiyat. */
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
});

export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: id(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: text("rate").notNull(),
    date: text("date").notNull(),
    source: text("source").notNull(),
  },
  (t) => [unique("fx_unique").on(t.base, t.quote, t.date)],
);

/** HPI, enflasyon, amortisman gibi zaman serileri. */
export const indexSeries = sqliteTable(
  "index_series",
  {
    id: id(),
    indexKey: text("index_key").notNull(), // "TR-IST-HPI", "TR-CPI", "US-CPI"
    period: text("period").notNull(), // "2026-07"
    value: text("value").notNull(),
    source: text("source"),
  },
  (t) => [unique("index_unique").on(t.indexKey, t.period)],
);

/* ------------------------------------------------------------------ */
/* Türev veriler ve ayarlar                                            */
/* ------------------------------------------------------------------ */

/** Servet eğrisi için günlük anlık görüntü. */
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: id(),
    date: text("date").notNull(),
    totalUsd: text("total_usd").notNull(),
    breakdown: text("breakdown", { mode: "json" })
      .$type<Record<string, string>>()
      .default({}),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [unique("snapshot_date_unique").on(t.date)],
);

/** Yeniden dengeleme hedefleri. */
export const targets = sqliteTable("targets", {
  id: id(),
  dimension: text("dimension", { enum: ["kind", "country", "currency", "asset"] }).notNull(),
  key: text("key").notNull(), // "crypto", "TR", "USD", <assetId>
  targetPct: text("target_pct").notNull(), // 0-1
  tolerancePct: text("tolerance_pct").notNull().default("0.05"),
});

export const alerts = sqliteTable("alerts", {
  id: id(),
  symbol: text("symbol").notNull(),
  condition: text("condition", { enum: ["above", "below"] }).notNull(),
  threshold: text("threshold").notNull(),
  currency: text("currency").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  firedAt: text("fired_at"),
  note: text("note"),
  ...timestamps,
});

/** Stopaj oranları — mevzuat değişir, koda gömülmez. */
export const withholdingRates = sqliteTable("withholding_rates", {
  id: id(),
  currency: text("currency").notNull(), // "TRY" | "USD" | "*"
  maxTermDays: integer("max_term_days"), // null = üst sınır yok
  rate: text("rate").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  note: text("note"),
});

/** Tek satırlık ayar tablosu (id = "singleton"). */
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("singleton"),
  baseCurrency: text("base_currency").notNull().default("USD"),
  locale: text("locale").notNull().default("tr-TR"),
  monthlyLivingCost: text("monthly_living_cost").default("0"),
  livingCostCurrency: text("living_cost_currency").default("USD"),
  riskProfile: text("risk_profile", { enum: ["conservative", "balanced", "aggressive"] })
    .notNull()
    .default("balanced"),
  idleCashThreshold: text("idle_cash_threshold").default("50000"),
  concentrationThreshold: text("concentration_threshold").default("0.25"),

  /** Yatırım vadesi (yıl) — dağılım önerisi bunu kullanır. */
  horizonYears: integer("horizon_years").default(20),

  /**
   * PIN doğrulaması. Parola asla düz metin saklanmaz:
   * scrypt(pin, salt) türetilir ve sadece sonuç tutulur.
   */
  pinHash: text("pin_hash"),
  pinSalt: text("pin_salt"),
  /** Oturum çerezini imzalayan gizli anahtar — ilk kurulumda üretilir. */
  sessionSecret: text("session_secret"),
  /** Kurulum sihirbazı tamamlandı mı? */
  setupCompleted: integer("setup_completed", { mode: "boolean" })
    .notNull()
    .default(false),

  /** Opsiyonel temel analiz sağlayıcısı anahtarı (Finnhub vb.). */
  fundamentalsApiKey: text("fundamentals_api_key"),

  /**
   * İki faktörlü doğrulama (TOTP).
   * Gizli anahtar base32; yalnızca kurulum sırasında gösterilir.
   */
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  /** Tek kullanımlık kurtarma kodlarının hash'leri (JSON dizi). */
  recoveryCodes: text("recovery_codes", { mode: "json" }).$type<string[]>().default([]),

  /**
   * İzin verilen IP listesi (virgülle ayrılmış, CIDR destekli).
   * Boşsa kısıtlama yok.
   */
  allowedIps: text("allowed_ips"),

  ...timestamps,
});

/**
 * Giriş denemeleri — kaba kuvvet takibi ve güvenlik günlüğü.
 *
 * Bellekte tutmak yetmiyor: sunucu yeniden başlarsa sayaç sıfırlanır
 * ve saldırgan bunu tetikleyebilir. Kalıcı kayıt bunu engeller.
 */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: id(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    success: integer("success", { mode: "boolean" }).notNull(),
    reason: text("reason"),
    at: text("at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("login_attempts_at_idx").on(t.at)],
);

/**
 * Borçlar — kredi, ipotek, taşıt kredisi.
 *
 * Net servet = varlıklar − kalan borçlar. Borcu göz ardı etmek,
 * 3M'lik evi 1M peşinatla alan birini 3M zengin sanmak demektir.
 */
export const liabilities = sqliteTable(
  "liabilities",
  {
    id: id(),
    /** Hangi varlık için alındı. Genel tüketici kredisinde null. */
    assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    lender: text("lender"),
    currency: text("currency").notNull(),

    /** Çekilen anapara. */
    principal: text("principal").notNull(),
    /** Yıllık nominal faiz oranı (0.35 = %35). */
    annualRate: text("annual_rate").notNull(),
    /** Vade (ay). */
    termMonths: integer("term_months").notNull(),
    startDate: text("start_date").notNull(),

    /**
     * Ödenen taksit sayısı. Kalan borç bundan hesaplanır —
     * "kalan bakiye" ayrıca saklanmaz ki iki kayıt çelişmesin.
     */
    paymentsMade: integer("payments_made").notNull().default(0),

    status: text("status", { enum: ["active", "paid", "settled"] })
      .notNull()
      .default("active"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("liabilities_asset_idx").on(t.assetId),
    index("liabilities_status_idx").on(t.status),
  ],
);

/** İzleme listesi — henüz alınmamış ama takip edilen enstrümanlar. */
export const watchlist = sqliteTable(
  "watchlist",
  {
    id: id(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["equity", "crypto", "commodity"] }).notNull(),
    exchange: text("exchange"),
    currency: text("currency"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [unique("watchlist_symbol_unique").on(t.symbol)],
);

export type Asset = typeof assets.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Venture = typeof ventures.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Liability = typeof liabilities.$inferSelect;
