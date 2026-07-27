import { z } from "zod";
import Decimal from "decimal.js";

/**
 * Tüm form doğrulamalarının tek kaynağı.
 *
 * Aynı şema hem istemcide (anında geri bildirim) hem sunucuda
 * (güvenlik) çalışır. İkisini ayrı yazmak, birinin diğerinden
 * sapmasına ve sunucuya geçersiz veri sızmasına yol açardı.
 */

/* ------------------------------------------------------------------ */
/* Ortak alan tipleri                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ondalık string doğrulaması.
 *
 * Tek `superRefine` içinde yapılıyor çünkü Zod zincirlenmiş `.refine`
 * çağrılarını ilki başarısız olsa da çalıştırır — "abc" gibi bir girdide
 * sonraki kontroldeki `new Decimal(v)` istisna fırlatır ve doğrulama
 * çöker. Sıralı ve erken çıkışlı tek kontrol bunu engelliyor.
 */
const decimalString = (opts: { min?: number; max?: number; label?: string } = {}) =>
  z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value === "") {
        ctx.addIssue({
          code: "custom",
          message: `${opts.label ?? "Bu alan"} zorunlu`,
        });
        return;
      }

      let d: Decimal;
      try {
        d = new Decimal(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Geçerli bir sayı girin" });
        return;
      }

      if (!d.isFinite()) {
        ctx.addIssue({ code: "custom", message: "Geçerli bir sayı girin" });
        return;
      }
      if (opts.min !== undefined && d.lessThan(opts.min)) {
        ctx.addIssue({
          code: "custom",
          message: opts.min === 0 ? "Negatif olamaz" : `En az ${opts.min} olmalı`,
        });
        return;
      }
      if (opts.max !== undefined && d.greaterThan(opts.max)) {
        ctx.addIssue({ code: "custom", message: `En fazla ${opts.max} olabilir` });
      }
    })
    // Doğrulama geçtiyse normalize et; geçmediyse bu değer kullanılmayacak
    .transform((v) => {
      try {
        return new Decimal(v).toFixed();
      } catch {
        return v;
      }
    });

/**
 * Boş bırakılabilen para alanı — boşsa veya hiç gönderilmemişse "0".
 * Formda alanın var olmaması (undefined) ile boş olması aynı sayılır.
 */
const optionalDecimal = (max?: number) =>
  z.preprocess(
    (v) =>
      v === undefined || v === null || (typeof v === "string" && v.trim() === "")
        ? "0"
        : typeof v === "string"
          ? v.trim()
          : v,
    decimalString({ min: 0, max }),
  );

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,5}$/, "Geçersiz para birimi");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih GG.AA.YYYY biçiminde seçilmeli")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Geçersiz tarih");

const pastOrToday = isoDate.refine((v) => {
  const d = new Date(v + "T00:00:00Z");
  // Yarının başlangıcına kadar kabul — saat dilimi farkı yüzünden
  // "bugün" seçimi reddedilmesin
  return d.getTime() <= Date.now() + 86_400_000;
}, "Gelecek bir tarih seçilemez");

const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Ülke kodu iki harf olmalı");

const name = z.string().trim().min(1, "İsim zorunlu").max(120, "İsim çok uzun");

const note = z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => v || null);

/** Sahip olunan mu, almayı planlanan mı? */
const assetStatus = z.enum(["active", "planned"]);

/* ------------------------------------------------------------------ */
/* Ödeme kaynağı — her alım formunda                                   */
/* ------------------------------------------------------------------ */

const optionalId = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null);

/**
 * Varlık edinildiğinde para nereden çıktı?
 * Formlarda `funding*` önekli alanlar olarak gelir.
 */
const fundingFields = {
  fundingMode: z.enum(["cash", "external", "loan"]).default("cash"),
  fundingCashAssetId: optionalId,
  fundingDownPayment: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  loanName: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => v || null),
  loanLender: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => v || null),
  loanAnnualRate: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || "0"),
  loanTermMonths: z.coerce.number().int().min(0).max(600).default(0),
  loanStartDate: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),
};

export type FundingFields = {
  fundingMode: "cash" | "external" | "loan";
  fundingCashAssetId: string | null;
  fundingDownPayment: string | null;
  loanName: string | null;
  loanLender: string | null;
  loanAnnualRate: string;
  loanTermMonths: number;
  loanStartDate: string | null;
};

/** Doğrulanmış form verisinden `applyFunding` girdisi üretir. */
export function toFundingInput(d: FundingFields, fallbackDate: string) {
  return {
    mode: d.fundingMode,
    cashAssetId: d.fundingCashAssetId,
    downPayment: d.fundingDownPayment,
    loan:
      d.fundingMode === "loan" && d.loanTermMonths > 0
        ? {
            name: d.loanName ?? undefined,
            lender: d.loanLender,
            annualRate: d.loanAnnualRate,
            termMonths: d.loanTermMonths,
            startDate: d.loanStartDate ?? fallbackDate,
          }
        : null,
  };
}

const liquidity = z.enum(["instant", "days", "weeks", "months", "illiquid"]);

/* ------------------------------------------------------------------ */
/* Hesap                                                               */
/* ------------------------------------------------------------------ */

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  institution: name,
  country,
  type: z.enum(["bank", "broker", "wallet", "cash", "other"]),
  currency,
  note,
});
export type AccountInput = z.infer<typeof accountSchema>;

/* ------------------------------------------------------------------ */
/* Nakit                                                               */
/* ------------------------------------------------------------------ */

export const cashSchema = z.object({
  id: z.string().uuid().optional(),
  name,
  currency,
  country: country.optional().or(z.literal("")).transform((v) => v || null),
  amount: decimalString({ min: 0, label: "Tutar" }),
  accountId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  note,
});
export type CashInput = z.infer<typeof cashSchema>;

/* ------------------------------------------------------------------ */
/* Piyasa pozisyonu (hisse / kripto / emtia)                           */
/* ------------------------------------------------------------------ */

export const positionSchema = z.object({
  ...fundingFields,
  id: z.string().uuid().optional(),
  kind: z.enum(["equity", "crypto", "commodity"]),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Sembol seçin")
    .max(24, "Sembol çok uzun"),
  name,
  currency,
  country: country.optional().or(z.literal("")).transform((v) => v || null),
  accountId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  status: assetStatus.default("active"),

  quantity: decimalString({ min: 0, label: "Miktar" }).refine(
    (v) => new Decimal(v).greaterThan(0),
    "Miktar sıfırdan büyük olmalı",
  ),
  /** Birim alış fiyatı. Toplam tutar bundan hesaplanır. */
  pricePerUnit: decimalString({ min: 0, label: "Alış fiyatı" }),
  purchaseDate: pastOrToday,
  fee: optionalDecimal(),
  note,
});
export type PositionInput = z.infer<typeof positionSchema>;

/* ------------------------------------------------------------------ */
/* Mevduat                                                             */
/* ------------------------------------------------------------------ */

export const depositSchema = z
  .object({
  ...fundingFields,
    id: z.string().uuid().optional(),
    name,
    currency,
    accountId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
    principal: decimalString({ min: 0, label: "Anapara" }).refine(
      (v) => new Decimal(v).greaterThan(0),
      "Anapara sıfırdan büyük olmalı",
    ),
    /** Yıllık brüt oran, ondalık olarak (0.42 = %42). */
    annualRate: decimalString({ min: 0, max: 5, label: "Faiz oranı" }),
    compounding: z.enum([
      "simple", "daily", "monthly", "quarterly", "annual", "continuous",
    ]),
    dayCount: z.enum(["ACT/365", "ACT/360", "30/360"]),
    startDate: pastOrToday,
    maturityDate: isoDate.optional().or(z.literal("")).transform((v) => v || null),
    withholdingRateOverride: z
      .string()
      .trim()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null),
    autoRenew: z.coerce.boolean().default(false),
    note,
  })
  .refine(
    (d) => !d.maturityDate || d.maturityDate > d.startDate,
    { message: "Vade tarihi başlangıçtan sonra olmalı", path: ["maturityDate"] },
  );
export type DepositInput = z.infer<typeof depositSchema>;

/* ------------------------------------------------------------------ */
/* Gayrimenkul                                                         */
/* ------------------------------------------------------------------ */

export const propertySchema = z.object({
  ...fundingFields,
  id: z.string().uuid().optional(),
  name,
  status: assetStatus.default("active"),
  city: z.string().trim().min(1, "Şehir seçin").max(120),
  country,
  addressLine: z.string().trim().max(240).optional().or(z.literal("")).transform((v) => v || null),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  currency,

  purchasePrice: decimalString({ min: 0, label: "Alış fiyatı" }),
  purchaseDate: pastOrToday,
  closingCosts: optionalDecimal(),
  renovationCost: optionalDecimal(),
  indexKey: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),
  manualValue: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),

  monthlyRent: optionalDecimal(),
  occupancyRate: decimalString({ min: 0, max: 1, label: "Doluluk oranı" }).default("1"),
  hoa: optionalDecimal(),
  propertyTax: optionalDecimal(),
  insurance: optionalDecimal(),
  maintenance: optionalDecimal(),
  note,
});
export type PropertyInput = z.infer<typeof propertySchema>;

/* ------------------------------------------------------------------ */
/* Araç                                                                */
/* ------------------------------------------------------------------ */

const currentYear = new Date().getFullYear();

export const vehicleSchema = z.object({
  ...fundingFields,
  id: z.string().uuid().optional(),
  name,
  status: assetStatus.default("active"),
  make: z.string().trim().min(1, "Marka zorunlu").max(60),
  model: z.string().trim().min(1, "Model zorunlu").max(60),
  year: z.coerce
    .number()
    .int("Yıl tam sayı olmalı")
    .min(1900, "Yıl 1900'den küçük olamaz")
    .max(currentYear + 2, "Geçersiz model yılı"),
  odometer: z.coerce.number().int().min(0, "Negatif olamaz").max(3_000_000).default(0),
  country,
  currency,
  segment: z.enum([
    "luxury", "premium", "mid", "economy", "ev", "classic", "commercial",
  ]),

  purchasePrice: decimalString({ min: 0, label: "Alış fiyatı" }),
  purchaseDate: pastOrToday,
  manualValue: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),

  insurance: optionalDecimal(),
  tax: optionalDecimal(),
  maintenance: optionalDecimal(),
  fuel: optionalDecimal(),
  note,
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

/* ------------------------------------------------------------------ */
/* Girişim                                                             */
/* ------------------------------------------------------------------ */

export const ventureSchema = z
  .object({
  ...fundingFields,
    id: z.string().uuid().optional(),
    name,
    status: assetStatus.default("active"),
    legalName: z.string().trim().min(1, "Ticari unvan zorunlu").max(160),
    country,
    currency,
    sector: z.string().trim().max(80).optional().or(z.literal("")).transform((v) => v || null),
    stage: z.string().trim().max(40).optional().or(z.literal("")).transform((v) => v || null),

    ownershipPct: decimalString({ min: 0, max: 1, label: "Sahiplik oranı" }),
    committedCapital: decimalString({ min: 0, label: "Taahhüt edilen sermaye" }),
    calledCapital: optionalDecimal(),
    valuation: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),
    valuationDate: isoDate.optional().or(z.literal("")).transform((v) => v || null),

    monthlyRevenue: optionalDecimal(),
    monthlyBurn: optionalDecimal(),
    cashOnHand: optionalDecimal(),
    note,
  })
  .refine(
    (v) => new Decimal(v.calledCapital).lessThanOrEqualTo(v.committedCapital),
    {
      message: "Ödenen sermaye taahhütten fazla olamaz",
      path: ["calledCapital"],
    },
  );
export type VentureInput = z.infer<typeof ventureSchema>;

/* ------------------------------------------------------------------ */
/* İşlem (mevcut varlığa alım/satım/gelir/gider ekleme)                */
/* ------------------------------------------------------------------ */

export const transactionSchema = z.object({
  id: z.string().uuid().optional(),
  assetId: z.string().uuid("Varlık seçin"),
  type: z.enum([
    "buy", "sell", "dividend", "interest", "rent", "staking",
    "expense", "fee", "tax", "deposit_in", "withdraw",
    "capital_call", "distribution", "valuation",
  ]),
  date: pastOrToday,
  quantity: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),
  pricePerUnit: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),
  amount: decimalString({ min: 0, label: "Tutar" }),
  currency,
  fee: optionalDecimal(),
  note,
});
export type TransactionInput = z.infer<typeof transactionSchema>;

/* ------------------------------------------------------------------ */
/* Ayarlar ve hedefler                                                 */
/* ------------------------------------------------------------------ */

export const settingsSchema = z.object({
  baseCurrency: currency,
  monthlyLivingCost: optionalDecimal(),
  livingCostCurrency: currency,
  riskProfile: z.enum(["conservative", "balanced", "aggressive"]),
  horizonYears: z.coerce.number().int().min(1).max(60),
  idleCashThreshold: optionalDecimal(),
  concentrationThreshold: decimalString({ min: 0, max: 1, label: "Yoğunlaşma eşiği" }),
  // Varsayılanlı: eski bir sayfadan gönderilen form bu alanları
  // içermeyebilir ve bu yüzden kaydın tamamen reddedilmesi yanlış olur.
  lotMethod: z.enum(["fifo", "lifo", "hifo"]).default("fifo"),
  longTermDays: z.coerce.number().int().min(1).max(3650).default(365),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

/**
 * Kullanıcının düzenleyebildiği varsayımlar.
 *
 * Enflasyon için üst sınır bilerek geniş (%500): yüksek enflasyonlu
 * ülkelerde %100 üzeri gerçektir, ama %1000 girdi hatasıdır.
 * Alt sınır negatif olabilir — deflasyon da bir gerçektir.
 */
export const assumptionsSchema = z.object({
  inflationTRY: decimalString({ min: -0.5, max: 5, label: "TRY enflasyonu" }),
  inflationUSD: decimalString({ min: -0.5, max: 5, label: "USD enflasyonu" }),
  inflationEUR: decimalString({ min: -0.5, max: 5, label: "EUR enflasyonu" }),
  inflationGBP: decimalString({ min: -0.5, max: 5, label: "GBP enflasyonu" }),
  inflationCHF: decimalString({ min: -0.5, max: 5, label: "CHF enflasyonu" }),
  benchmark_usd_deposit: decimalString({ min: -0.5, max: 5, label: "USD mevduat getirisi" }),
  benchmark_gold: decimalString({ min: -0.5, max: 5, label: "Altın getirisi" }),
  benchmark_sp500: decimalString({ min: -0.5, max: 5, label: "S&P 500 getirisi" }),
  capitalGainsRate: decimalString({ min: 0, max: 1, label: "Sermaye kazancı oranı" })
    .optional()
    .transform((v) => v ?? "0"),
});
export type AssumptionsInput = z.infer<typeof assumptionsSchema>;

const targetSchema = z.object({
  dimension: z.enum(["kind", "country", "currency", "asset"]),
  key: z.string().trim().min(1),
  targetPct: decimalString({ min: 0, max: 1, label: "Hedef oran" }),
  tolerancePct: decimalString({ min: 0, max: 1, label: "Tolerans" }).default("0.05"),
});
export type TargetInput = z.infer<typeof targetSchema>;

/* ------------------------------------------------------------------ */
/* Alarmlar, bildirimler, tekrarlayan hareketler                        */
/* ------------------------------------------------------------------ */

export const alertSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1).max(24),
  condition: z.enum(["above", "below"]),
  threshold: decimalString({ min: 0, label: "Eşik" }),
  currency,
  note,
});
export type AlertFormInput = z.infer<typeof alertSchema>;

export const recurringSchema = z
  .object({
    id: z.string().trim().optional().or(z.literal("")).transform((v) => v || undefined),
    assetId: z.string().trim().min(1, "Hesap seçin"),
    label: z.string().trim().min(1, "Ad zorunlu").max(80),
    type: z.enum([
      "dividend", "interest", "rent", "staking",
      "expense", "fee", "tax", "deposit_in", "withdraw",
    ]),
    amount: decimalString({ min: 0, label: "Tutar" }),
    currency,
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    startDate: isoDate,
    endDate: isoDate.optional().or(z.literal("")).transform((v) => v || null),
    note,
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "Bitiş tarihi başlangıçtan önce olamaz",
    path: ["endDate"],
  });
export type RecurringFormInput = z.infer<typeof recurringSchema>;

/**
 * Webhook adresi.
 *
 * Yalnızca http/https kabul edilir. `javascript:` ve `file:` gibi şemalar
 * sunucudan istek yapılacağı için tehlikeli olur.
 */
export const notifySettingsSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => {
        if (v === "") return true;
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "http:// veya https:// ile başlayan geçerli bir adres girin" },
    )
    .transform((v) => v || null),
  schedulerEnabled: z
    .union([z.literal("on"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
});
export type NotifySettingsInput = z.infer<typeof notifySettingsSchema>;

export const goalSchema = z.object({
  id: z.string().trim().optional().or(z.literal("")).transform((v) => v || undefined),
  name,
  targetAmount: decimalString({ min: 0, label: "Hedef tutar" }),
  currency,
  targetDate: isoDate,
  kind: z.enum(["retirement", "property", "education", "emergency", "other"]),
  priority: z.coerce.number().int().min(1).max(9).default(1),
  note,
});
export type GoalFormInput = z.infer<typeof goalSchema>;

export const watchlistSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1).max(24),
  name,
  kind: z.enum(["equity", "crypto", "commodity"]),
  exchange: z.string().trim().max(40).optional().or(z.literal("")).transform((v) => v || null),
  currency: currency.optional().or(z.literal("")).transform((v) => v || null),
  note,
});
export type WatchlistInput = z.infer<typeof watchlistSchema>;

/* ------------------------------------------------------------------ */
/* Yardımcı                                                            */
/* ------------------------------------------------------------------ */

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  fieldErrors?: Record<string, string>;
}

/**
 * FormData'yı şemaya göre doğrular ve alan bazlı hata haritası döner.
 * Arayüz hataları alanın yanında gösterebilsin diye düz bir harita.
 */
export function validate<T>(
  schema: z.ZodType<T>,
  formData: FormData,
): ValidationResult<T> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }

  const result = schema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    // İlk hata yeterli — kullanıcıya bir alan için beş mesaj göstermek
    // yardımcı olmaz
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { success: false, fieldErrors };
}
