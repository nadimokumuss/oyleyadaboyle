import { describe, it, expect } from "vitest";
import { Money } from "@/lib/money";
import { proposeAllocation, compareToCurrent, type AllocationInput } from "./allocation";

function input(over: Partial<AllocationInput> = {}): AllocationInput {
  return {
    riskProfile: "balanced",
    horizonYears: 20,
    monthlyLivingCost: Money.of(8000, "USD"),
    totalWealth: Money.of(10_000_000, "USD"),
    hasVentures: true,
    ...over,
  };
}

describe("proposeAllocation", () => {
  it("oranların toplamı %100 eder", () => {
    for (const profile of ["conservative", "balanced", "aggressive"] as const) {
      const p = proposeAllocation(input({ riskProfile: profile }));
      const total = p.slices.reduce((a, s) => a.plus(s.targetPct), Money.zero("USD").amount);
      expect(total.toDecimalPlaces(6).toNumber()).toBe(1);
    }
  });

  it("tutarların toplamı serveti verir", () => {
    const p = proposeAllocation(input());
    const sum = p.slices.reduce((a, s) => a.plus(s.amount), Money.zero("USD"));
    expect(sum.round(0).toNumber()).toBe(10_000_000);
  });

  it("atak profil temkinliden daha çok hisse önerir", () => {
    const agg = proposeAllocation(input({ riskProfile: "aggressive" }));
    const con = proposeAllocation(input({ riskProfile: "conservative" }));
    const eq = (p: typeof agg) =>
      p.slices.find((s) => s.kind === "equity")?.targetPct.toNumber() ?? 0;
    expect(eq(agg)).toBeGreaterThan(eq(con));
  });

  it("temkinli profil atak profilden daha çok sabit getiri önerir", () => {
    const agg = proposeAllocation(input({ riskProfile: "aggressive" }));
    const con = proposeAllocation(input({ riskProfile: "conservative" }));
    const dep = (p: typeof agg) =>
      p.slices.find((s) => s.kind === "deposit")?.targetPct.toNumber() ?? 0;
    expect(dep(con)).toBeGreaterThan(dep(agg));
  });

  it("temkinli profilde kripto önerilmez", () => {
    const p = proposeAllocation(input({ riskProfile: "conservative" }));
    expect(p.slices.find((s) => s.kind === "crypto")).toBeUndefined();
  });

  it("kısa vadede hisse ağırlığı düşer", () => {
    const long = proposeAllocation(input({ horizonYears: 20 }));
    const short = proposeAllocation(input({ horizonYears: 2 }));
    const eq = (p: typeof long) =>
      p.slices.find((s) => s.kind === "equity")?.targetPct.toNumber() ?? 0;
    expect(eq(short)).toBeLessThan(eq(long));
  });

  it("kısa vadede uyarı metni eklenir", () => {
    const p = proposeAllocation(input({ horizonYears: 3 }));
    expect(p.caveats.some((c) => c.includes("kısa"))).toBe(true);
  });

  it("çok uzun vadede hisse ağırlığı artar", () => {
    const normal = proposeAllocation(input({ horizonYears: 20 }));
    const veryLong = proposeAllocation(input({ horizonYears: 40 }));
    const eq = (p: typeof normal) =>
      p.slices.find((s) => s.kind === "equity")?.targetPct.toNumber() ?? 0;
    expect(eq(veryLong)).toBeGreaterThan(eq(normal));
  });

  it("girişim istenmiyorsa payı hisseye aktarılır", () => {
    const withV = proposeAllocation(input({ hasVentures: true }));
    const without = proposeAllocation(input({ hasVentures: false }));
    expect(without.slices.find((s) => s.kind === "venture")).toBeUndefined();
    const eq = (p: typeof withV) =>
      p.slices.find((s) => s.kind === "equity")!.targetPct.toNumber();
    expect(eq(without)).toBeGreaterThan(eq(withV));
  });

  it("küçük servette acil durum yastığı nakit payını yükseltir", () => {
    const big = proposeAllocation(input({ totalWealth: Money.of(10_000_000, "USD") }));
    const small = proposeAllocation(input({ totalWealth: Money.of(100_000, "USD") }));
    const cash = (p: typeof big) =>
      p.slices.find((s) => s.kind === "cash")!.targetPct.toNumber();
    expect(cash(small)).toBeGreaterThan(cash(big));
  });

  it("acil durum yastığı aylık giderden hesaplanır", () => {
    const p = proposeAllocation(input());
    expect(p.emergencyMonths).toBe(6);
    expect(p.emergencyAmount.toNumber()).toBe(48_000);
  });

  it("temkinli profilde yastık 12 ay", () => {
    const p = proposeAllocation(input({ riskProfile: "conservative" }));
    expect(p.emergencyMonths).toBe(12);
  });

  it("her dilim gerekçe taşır", () => {
    const p = proposeAllocation(input());
    for (const s of p.slices) {
      expect(s.rationale.length).toBeGreaterThan(20);
    }
  });

  it("atak profilde risk uyarısı verilir", () => {
    const p = proposeAllocation(input({ riskProfile: "aggressive" }));
    expect(p.caveats.some((c) => c.includes("yarıya"))).toBe(true);
  });

  it("sıfır servette patlamaz", () => {
    const p = proposeAllocation(input({ totalWealth: Money.zero("USD") }));
    expect(p.slices.length).toBeGreaterThan(0);
    expect(p.slices.every((s) => s.amount.isZero())).toBe(true);
  });
});

describe("compareToCurrent", () => {
  const proposal = proposeAllocation(input());
  const wealth = Money.of(10_000_000, "USD");

  it("hedefe uygun olanı 'uygun' işaretler", () => {
    // Hedefle birebir aynı dağılım
    const current = Object.fromEntries(
      proposal.slices.map((s) => [s.kind, s.amount.toDb()]),
    );
    const gaps = compareToCurrent(proposal, current, wealth);
    expect(gaps.every((g) => g.action === "uygun")).toBe(true);
  });

  it("eksik sınıfı 'artır' der ve tutarı verir", () => {
    const current = { cash: "10000000" };
    const gaps = compareToCurrent(proposal, current, wealth);
    const equity = gaps.find((g) => g.kind === "equity")!;
    expect(equity.action).toBe("artır");
    expect(equity.delta.isPositive()).toBe(true);
  });

  it("fazla olan sınıfı 'azalt' der", () => {
    const current = { cash: "10000000" };
    const gaps = compareToCurrent(proposal, current, wealth);
    const cash = gaps.find((g) => g.kind === "cash")!;
    expect(cash.action).toBe("azalt");
    expect(cash.delta.isNegative()).toBe(true);
  });

  it("en büyük sapma en üstte sıralanır", () => {
    const gaps = compareToCurrent(proposal, { cash: "10000000" }, wealth);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i - 1].delta.amount.abs().toNumber()).toBeGreaterThanOrEqual(
        gaps[i].delta.amount.abs().toNumber(),
      );
    }
  });

  it("boş portföyde patlamaz", () => {
    const gaps = compareToCurrent(proposal, {}, wealth);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.currentPct.isZero())).toBe(true);
  });

  it("tolerans içindeki sapma 'uygun' sayılır", () => {
    const current = Object.fromEntries(
      proposal.slices.map((s) => [
        s.kind,
        s.amount.times(1.02).toDb(), // %2 sapma
      ]),
    );
    const gaps = compareToCurrent(proposal, current, wealth, 0.05);
    expect(gaps.every((g) => g.action === "uygun")).toBe(true);
  });
});
