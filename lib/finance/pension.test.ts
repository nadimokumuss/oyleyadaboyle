import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import {
  vestedRatio,
  valuePension,
  yearsInSystem,
  projectPension,
  DEFAULT_VESTING_TIERS,
  type PensionTerms,
} from "./pension";

const try_ = (n: string | number) => Money.of(n, "TRY");
const START = new Date("2020-01-01");

const base: PensionTerms = {
  participantBalance: try_(100_000),
  stateContribution: try_(30_000),
  startDate: START,
  retirementDate: null,
  tiers: DEFAULT_VESTING_TIERS,
  monthlyContribution: try_(2_000),
};

describe("yearsInSystem", () => {
  it("geçen yılı hesaplar", () => {
    expect(yearsInSystem(START, new Date("2026-01-01")).toNumber()).toBeCloseTo(6, 1);
  });

  it("başlangıçtan önce sıfır — negatif dönmez", () => {
    expect(yearsInSystem(START, new Date("2019-01-01")).toFixed()).toBe("0");
  });
});

describe("vestedRatio — hak ediş", () => {
  it("3 yıldan önce hiçbir katkı hak edilmez", () => {
    expect(vestedRatio(START, new Date("2022-06-01")).toFixed()).toBe("0");
  });

  it("3 yılda %15", () => {
    expect(vestedRatio(START, new Date("2023-06-01")).toFixed(2)).toBe("0.15");
  });

  it("6 yılda %35", () => {
    expect(vestedRatio(START, new Date("2026-06-01")).toFixed(2)).toBe("0.35");
  });

  it("10 yılda %60", () => {
    expect(vestedRatio(START, new Date("2030-06-01")).toFixed(2)).toBe("0.60");
  });

  it("kademeler arası ara değer vermez — eşik tabanlı", () => {
    // 5 yıl 11 ay ile 3 yıl aynı orana tabidir.
    const almostSix = vestedRatio(START, new Date("2025-12-01"));
    const justThree = vestedRatio(START, new Date("2023-02-01"));
    expect(almostSix.toFixed(2)).toBe(justThree.toFixed(2));
  });

  it("emeklilik tarihi geldiyse kademelere bakmadan %100", () => {
    const ratio = vestedRatio(
      START,
      new Date("2022-01-01"), // henüz 3 yıl dolmamış
      DEFAULT_VESTING_TIERS,
      new Date("2021-06-01"), // ama emeklilik hakkı kazanılmış
    );
    expect(ratio.toFixed()).toBe("1");
  });

  it("kademeler sırasız gelse de en yükseğini bulur", () => {
    const shuffled = [
      { years: 10, pct: "0.60" },
      { years: 3, pct: "0.15" },
      { years: 6, pct: "0.35" },
    ];
    expect(vestedRatio(START, new Date("2030-06-01"), shuffled).toFixed(2)).toBe("0.60");
  });

  it("özel kademeler kullanılabilir", () => {
    const custom = [{ years: 1, pct: "1" }];
    expect(vestedRatio(START, new Date("2022-01-01"), custom).toFixed()).toBe("1");
  });

  it("oran 1'i aşamaz", () => {
    const silly = [{ years: 1, pct: "5" }];
    expect(vestedRatio(START, new Date("2026-01-01"), silly).toFixed()).toBe("1");
  });

  it("boş kademe listesinde sıfır", () => {
    expect(vestedRatio(START, new Date("2030-01-01"), []).toFixed()).toBe("0");
  });
});

describe("valuePension", () => {
  it("net servete birikim + hak edilmiş katkı yazılır", () => {
    // 2026: 6 yıl → %35 hak ediş → 30.000 × 0,35 = 10.500
    const v = valuePension(base, new Date("2026-06-01"));
    expect(v.vestedState.toDb()).toBe("10500");
    expect(v.vestedValue.toDb()).toBe("110500");
  });

  it("hak edilmemiş katkı ayrı gösterilir, servete girmez", () => {
    const v = valuePension(base, new Date("2026-06-01"));
    expect(v.unvestedState.toDb()).toBe("19500");
    // Toplam katkı = hak edilen + edilmeyen
    expect(Number(v.vestedState.toDb()) + Number(v.unvestedState.toDb())).toBe(30000);
  });

  it("3 yıl dolmadan katkının tamamı hak edilmemiş", () => {
    const v = valuePension(base, new Date("2022-01-01"));
    expect(v.vestedState.toDb()).toBe("0");
    expect(v.vestedValue.toDb()).toBe("100000");
    expect(v.unvestedState.toDb()).toBe("30000");
  });

  it("emeklilikte katkının tamamı hak edilir", () => {
    const v = valuePension(
      { ...base, retirementDate: new Date("2025-01-01") },
      new Date("2026-01-01"),
    );
    expect(v.retired).toBe(true);
    expect(v.vestedValue.toDb()).toBe("130000");
    expect(v.unvestedState.toDb()).toBe("0");
  });

  it("sıradaki kademeyi ve kalan süreyi bildirir", () => {
    const v = valuePension(base, new Date("2026-01-01"));
    expect(v.nextTier?.years).toBe(10);
    expect(v.nextTier!.yearsRemaining.toNumber()).toBeCloseTo(4, 0);
  });

  it("tüm kademeler dolduysa sıradaki yok", () => {
    expect(valuePension(base, new Date("2035-01-01")).nextTier).toBeNull();
  });

  it("erken çıkış değeri hak edilmiş tutara eşit", () => {
    const v = valuePension(base, new Date("2026-06-01"));
    expect(v.earlyExitValue.toDb()).toBe(v.vestedValue.toDb());
  });

  it("devlet katkısı yoksa çökmez", () => {
    const v = valuePension({ ...base, stateContribution: try_(0) }, new Date("2026-01-01"));
    expect(v.vestedValue.toDb()).toBe("100000");
    expect(v.unvestedState.toDb()).toBe("0");
  });
});

describe("projectPension", () => {
  it("katkılar birikimi artırır", () => {
    const p = projectPension(base, new Date("2026-01-01"), new Date("2036-01-01"), "0.10");
    expect(Number(p.finalBalance.toDb())).toBeGreaterThan(130_000);
    expect(Number(p.totalContributed.toDb())).toBeCloseTo(240_000, -3);
  });

  it("devlet katkısı katkı payının oranı kadar", () => {
    const p = projectPension(base, new Date("2026-01-01"), new Date("2036-01-01"), "0", "0.30");
    expect(Number(p.totalStateMatch.toDb())).toBeCloseTo(
      Number(p.totalContributed.toDb()) * 0.3,
      2,
    );
  });

  it("geçmiş hedef tarihinde bugünkü bakiyeyi döner", () => {
    const p = projectPension(base, new Date("2026-01-01"), new Date("2020-01-01"), "0.10");
    expect(p.finalBalance.toDb()).toBe("130000");
    expect(p.totalContributed.toDb()).toBe("0");
  });

  it("yüksek getiri daha büyük bakiye verir", () => {
    const low = projectPension(base, new Date("2026-01-01"), new Date("2046-01-01"), "0.05");
    const high = projectPension(base, new Date("2026-01-01"), new Date("2046-01-01"), "0.15");
    expect(Number(high.finalBalance.toDb())).toBeGreaterThan(Number(low.finalBalance.toDb()));
  });
});
