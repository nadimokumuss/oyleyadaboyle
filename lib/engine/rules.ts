import Decimal from "decimal.js";
import { Money, formatMoney, formatPercent, formatNumber } from "@/lib/money";
import type { Opportunity, PortfolioState, Rule } from "./types";

/**
 * Fırsat kuralları — panelin "gelir kaynağı üretme" motoru.
 *
 * Her kural portföyü tarar ve somut, sayısal bir gözlem üretir.
 * Kurallar tavsiye vermez; hesap yapar ve sonucu gösterir. Kararı
 * kullanıcı verir.
 *
 * Yeni kural eklemek için: bir Rule yazın ve RULES dizisine ekleyin.
 */

const usd = (v: Decimal | string | number) => Money.of(v, "USD");

/* ------------------------------------------------------------------ */
/* 1. Atıl nakit                                                       */
/* ------------------------------------------------------------------ */

const idleCash: Rule = {
  key: "idleCash",
  label: "Atıl nakit",
  evaluate(state) {
    const cashAssets = state.netWorth.assets.filter((a) => a.kind === "cash");
    const totalCash = cashAssets.reduce(
      (acc, a) => acc.plus(a.valueUsd),
      Money.zero("USD"),
    );

    if (totalCash.lte(usd(state.settings.idleCashThreshold))) return null;

    // Erişilebilir en iyi mevduat oranını referans al; yoksa makul bir USD oranı
    const bestNetRate = bestAvailableNetRate(state);
    const monthlyForegone = totalCash.times(bestNetRate).dividedBy(12);

    return {
      id: "idleCash",
      ruleKey: "idleCash",
      severity: monthlyForegone.gt(usd(2000)) ? "high" : "medium",
      title: "Nakit faizsiz bekliyor",
      detail:
        `${formatMoney(totalCash)} nakit getiri üretmeden duruyor. ` +
        `Bugünkü en iyi net mevduat oranınızla (${formatPercent(bestNetRate)}) ` +
        `bu para ayda ${formatMoney(monthlyForegone)} kazandırabilirdi — ` +
        `yılda ${formatMoney(monthlyForegone.times(12))}.`,
      action:
        "Kısa vadeli mevduata veya para piyasası fonuna yönlendirin; " +
        "acil ihtiyaç yastığı kadarını nakit tutun.",
      estimatedMonthlyGain: monthlyForegone,
      assetIds: cashAssets.map((a) => a.assetId),
    };
  },
};

function bestAvailableNetRate(state: PortfolioState): Decimal {
  const rates = state.deposits
    .filter((d) => d.currency === "USD")
    .map((d) => new Decimal(d.real.netNominalAnnual));
  if (rates.length === 0) return new Decimal("0.035");
  return rates.reduce((a, b) => (b.greaterThan(a) ? b : a));
}

/* ------------------------------------------------------------------ */
/* 2. Getiri arbitrajı — reel getiri karşılaştırması                   */
/* ------------------------------------------------------------------ */

const yieldArbitrage: Rule = {
  key: "yieldArbitrage",
  label: "Getiri arbitrajı",
  evaluate(state) {
    const losing = state.deposits.filter((d) => d.real.losingToInflation);
    if (losing.length === 0) return null;

    return losing.map((d): Opportunity => {
      const principal = Money.of(d.params.principal, d.currency);
      const realLoss = Money.of(d.real.purchasingPowerChange, d.currency).abs();

      return {
        id: `yieldArbitrage:${d.assetId}`,
        ruleKey: "yieldArbitrage",
        severity: "high",
        title: `${d.name} enflasyona yeniliyor`,
        detail:
          `${formatMoney(principal, { compact: true })} anapara ` +
          `${formatPercent(new Decimal(d.params.annualRate), { decimals: 1 })} brüt faiz alıyor, ` +
          `ama stopaj ve enflasyon sonrası reel getiri ` +
          `${formatPercent(new Decimal(d.real.realAnnual), { signed: true })}. ` +
          `Nominal olarak kazanırken satın alma gücü olarak yılda ` +
          `${formatMoney(realLoss, { compact: true })} kaybediyorsunuz.`,
        action:
          "Enflasyona endeksli enstrümanlar, döviz mevduatı veya reel varlıklar " +
          "(gayrimenkul, hisse) ile karşılaştırın.",
        estimatedMonthlyGain: null,
        assetIds: [d.assetId],
      };
    });
  },
};

/* ------------------------------------------------------------------ */
/* 3. Uyuyan varlık — boş konut, atıl araç                             */
/* ------------------------------------------------------------------ */

const dormantAsset: Rule = {
  key: "dormantAsset",
  label: "Uyuyan varlık",
  evaluate(state) {
    const out: Opportunity[] = [];

    for (const p of state.properties) {
      if (!p.foregoneMonthlyRent) continue;
      const foregone = Money.of(p.foregoneMonthlyRent, p.currency);
      out.push({
        id: `dormantAsset:property:${p.assetId}`,
        ruleKey: "dormantAsset",
        severity: "medium",
        title: `${p.name} kiraya verilmemiş`,
        detail:
          `${formatMoney(Money.of(p.currentValue, p.currency), { compact: true })} ` +
          `değerindeki bu mülkten kira geliri kaydı yok. Bölge için tipik %5 brüt ` +
          `verimle ayda yaklaşık ${formatMoney(foregone, { compact: true })} ` +
          `gelir üretebilirdi.`,
        action: "Uzun dönem kiraya verin veya kısa dönem kiralamayı değerlendirin.",
        estimatedMonthlyGain: null,
        assetIds: [p.assetId],
      });
    }

    // Araçlar: yaşına göre çok az kullanılmış olanlar
    for (const v of state.vehicles) {
      const age = new Decimal(v.vehicleAgeYears);
      if (age.lessThan("0.5")) continue;
      const expectedKm = age.times(15_000);
      if (expectedKm.isZero()) continue;
      const usageRatio = new Decimal(v.odometer).dividedBy(expectedKm);
      if (usageRatio.greaterThan("0.25")) continue;

      const monthlyCost = v.monthlyCostOfOwnership
        ? Money.of(v.monthlyCostOfOwnership, v.currency)
        : null;
      if (!monthlyCost) continue;

      out.push({
        id: `dormantAsset:vehicle:${v.assetId}`,
        ruleKey: "dormantAsset",
        severity: "medium",
        title: `${v.name} neredeyse hiç kullanılmıyor`,
        detail:
          `${formatNumber(v.odometer, 0)} km ile yaşına göre beklenenin ` +
          `${formatPercent(usageRatio, { decimals: 0 })} kadarı kullanılmış, ` +
          `ama size ayda ${formatMoney(monthlyCost, { compact: true })} ` +
          `(değer kaybı + giderler) maliyeti var.`,
        action: "Satmayı veya kiraya vermeyi değerlendirin.",
        // Toplanabilmesi için USD'ye çevrilir
        estimatedMonthlyGain: state.toUsd(monthlyCost),
        assetIds: [v.assetId],
      });
    }

    return out;
  },
};

/* ------------------------------------------------------------------ */
/* 4. Kur erimesi                                                      */
/* ------------------------------------------------------------------ */

const fxErosion: Rule = {
  key: "fxErosion",
  label: "Kur erimesi",
  evaluate(state) {
    const total = state.netWorth.totalUsd;
    if (total.isZero()) return null;

    const tryExposure = Money.of(state.netWorth.byCurrency.TRY ?? "0", "USD");
    const share = tryExposure.ratioTo(total);
    if (share.lessThan("0.40")) return null;

    // TL varlıkların reel erimesi: yıllık enflasyon farkı kadar.
    // Oranlar ayarlardan gelir; koda gömülü olduklarında kullanıcı
    // kendi ülkesinin gerçeğini yansıtamıyordu.
    const { inflation } = state.assumptions;
    const inflationGap = new Decimal(inflation.TRY ?? "0.33").minus(
      inflation.USD ?? "0.028",
    );
    // Fark negatifse (TL enflasyonu USD'nin altına inmişse) erime yok.
    if (!inflationGap.isPositive()) return null;
    const annualErosion = tryExposure.times(inflationGap);

    return {
      id: "fxErosion",
      ruleKey: "fxErosion",
      severity: share.greaterThan("0.60") ? "high" : "medium",
      title: "TL maruziyeti yüksek",
      detail:
        `Servetinizin ${formatPercent(share, { decimals: 1 })} kadarı ` +
        `(${formatMoney(tryExposure)}) TL cinsinden. TL ve USD enflasyonu ` +
        `arasındaki fark bu kısmın satın alma gücünü yılda yaklaşık ` +
        `${formatMoney(annualErosion)} eritiyor.`,
      action:
        "Döviz, altın veya yabancı hisse ile dengeleyin; TL varlıkları " +
        "enflasyona endeksli getiri üretenlerle sınırlayın.",
      estimatedMonthlyGain: null,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 5. Yeniden dengeleme                                                */
/* ------------------------------------------------------------------ */

const rebalance: Rule = {
  key: "rebalance",
  label: "Yeniden dengeleme",
  evaluate(state) {
    if (state.targets.length === 0) return null;
    const total = state.netWorth.totalUsd;
    if (total.isZero()) return null;

    const drifts: Array<{ key: string; current: Decimal; target: Decimal; delta: Money }> = [];

    for (const t of state.targets.filter((x) => x.dimension === "kind")) {
      const current = Money.of(state.netWorth.byKind[t.key] ?? "0", "USD");
      const currentPct = current.ratioTo(total);
      const drift = currentPct.minus(t.targetPct);
      if (drift.abs().lessThanOrEqualTo(t.tolerancePct)) continue;

      drifts.push({
        key: t.key,
        current: currentPct,
        target: t.targetPct,
        delta: total.times(drift).negated(),
      });
    }

    if (drifts.length === 0) return null;

    const lines = drifts
      .sort((a, b) => b.delta.amount.abs().comparedTo(a.delta.amount.abs()))
      .map((d) => {
        const verb = d.delta.isPositive() ? "eklenmeli" : "azaltılmalı";
        return (
          `${KIND_LABEL[d.key] ?? d.key}: ` +
          `${formatPercent(d.current, { decimals: 1 })} → hedef ` +
          `${formatPercent(d.target, { decimals: 0 })} ` +
          `(${formatMoney(d.delta.abs(), { compact: true })} ${verb})`
        );
      });

    return {
      id: "rebalance",
      ruleKey: "rebalance",
      severity: "medium",
      title: `${drifts.length} varlık sınıfı hedeften saptı`,
      detail: lines.join(" · "),
      action:
        "Yeni para girişlerini eksik sınıfa yönlendirin — satış yapmadan " +
        "dengelemek vergi açısından genelde daha verimlidir.",
      estimatedMonthlyGain: null,
    };
  },
};

const KIND_LABEL: Record<string, string> = {
  equity: "Hisse",
  crypto: "Kripto",
  deposit: "Mevduat",
  realestate: "Gayrimenkul",
  vehicle: "Araç",
  venture: "Girişim",
  cash: "Nakit",
  bond: "Tahvil",
  pension: "Emeklilik",
  collectible: "Kıymetli eşya",
  commodity: "Emtia",
};

/* ------------------------------------------------------------------ */
/* 6. Vergi mahsubu                                                    */
/* ------------------------------------------------------------------ */

const taxHarvest: Rule = {
  key: "taxHarvest",
  label: "Vergi mahsubu",
  evaluate(state) {
    const losers = state.portfolio.positions.filter((p) =>
      new Decimal(p.unrealizedPnl).isNegative(),
    );
    if (losers.length === 0) return null;

    const realizedGain = new Decimal(state.portfolio.totals.realizedPnlUsd);
    if (!realizedGain.greaterThan(0)) return null;

    const harvestable = losers.reduce(
      (acc, p) => acc.plus(Money.of(p.unrealizedPnl, p.currency).abs()),
      Money.zero("USD"),
    );

    // Mahsup edilebilecek zarar, kârı aşamaz: fazlası o yılın vergisini
    // daha da azaltmaz.
    const offsettable = Decimal.min(
      new Decimal(harvestable.toDb()),
      realizedGain,
    );

    // Oran girilmediyse tutar telaffuz edilmez. Uydurma bir oranla
    // "şu kadar tasarruf edersiniz" demek, olmayan bir kesinlik satmaktır.
    const rate = new Decimal(state.assumptions.capitalGainsRate);
    const savingSentence = rate.greaterThan(0)
      ? ` %${rate.times(100).toDecimalPlaces(1)} sermaye kazancı oranıyla bu, ` +
        `yaklaşık ${formatMoney(usd(offsettable.times(rate)), { compact: true })} ` +
        `vergi tasarrufu demek.`
      : " Sermaye kazancı oranınızı Ayarlar'a girerseniz tasarruf tutarını da hesaplarım.";

    return {
      id: "taxHarvest",
      ruleKey: "taxHarvest",
      severity: "medium",
      title: "Zarardaki pozisyonlarla vergi mahsubu",
      detail:
        `Bu yıl ${formatMoney(usd(realizedGain))} gerçekleşmiş kârınız var. ` +
        `${losers.length} pozisyon zararda ve toplam ` +
        `${formatMoney(harvestable, { compact: true })} gerçekleşmemiş zarar taşıyor. ` +
        `Bunun ${formatMoney(usd(offsettable), { compact: true })} kadarı kârdan ` +
        `mahsup edilebilir.${savingSentence}`,
      action:
        "Vergi mevzuatınıza göre değerlendirin; benzer bir enstrümanla pozisyonu " +
        "koruyarak zararı realize etmek mümkün olabilir.",
      estimatedMonthlyGain: null,
      assetIds: losers.map((p) => p.assetId),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 7. Vade yenileme                                                    */
/* ------------------------------------------------------------------ */

const maturityRoll: Rule = {
  key: "maturityRoll",
  label: "Vade yenileme",
  evaluate(state) {
    const soon = state.deposits.filter(
      (d) =>
        d.snapshot.daysToMaturity !== null && d.snapshot.daysToMaturity <= 14,
    );
    const matured = state.deposits.filter((d) => d.snapshot.matured);

    const out: Opportunity[] = [];

    for (const d of matured) {
      out.push({
        id: `maturityRoll:matured:${d.assetId}`,
        ruleKey: "maturityRoll",
        severity: "critical",
        title: `${d.name} vadesi doldu — faiz işlemiyor`,
        detail:
          `${formatMoney(Money.of(d.snapshot.netBalance, d.currency), { compact: true })} ` +
          `bakiye vade sonrası getiri üretmiyor.`,
        action: "Hemen yenileyin veya başka bir enstrümana aktarın.",
        estimatedMonthlyGain: null,
        assetIds: [d.assetId],
      });
    }

    for (const d of soon) {
      out.push({
        id: `maturityRoll:soon:${d.assetId}`,
        ruleKey: "maturityRoll",
        severity: "high",
        title: `${d.name} vadesi ${d.snapshot.daysToMaturity} gün sonra doluyor`,
        detail:
          `${formatMoney(Money.of(d.snapshot.netBalance, d.currency), { compact: true })} ` +
          `serbest kalacak. Yenileme oranını şimdiden karşılaştırın — ` +
          `vade günü acele karar vermek genelde daha kötü oran demektir.`,
        action: "Bankalardan güncel oran alın ve yenileme talimatını hazırlayın.",
        estimatedMonthlyGain: null,
        assetIds: [d.assetId],
      });
    }

    return out;
  },
};

/* ------------------------------------------------------------------ */
/* 8. Yoğunlaşma riski                                                 */
/* ------------------------------------------------------------------ */

const concentrationRule: Rule = {
  key: "concentration",
  label: "Yoğunlaşma riski",
  evaluate(state) {
    const total = state.netWorth.totalUsd;
    if (total.isZero()) return null;

    const limit = state.settings.concentrationThreshold;
    const heavy = state.netWorth.assets
      .map((a) => ({ asset: a, share: a.valueUsd.ratioTo(total) }))
      .filter((x) => x.share.greaterThan(limit))
      .sort((a, b) => b.share.comparedTo(a.share));

    if (heavy.length === 0) return null;

    return heavy.map(({ asset, share }): Opportunity => ({
      id: `concentration:${asset.assetId}`,
      ruleKey: "concentration",
      severity: share.greaterThan("0.40") ? "high" : "medium",
      title: `${asset.name} tek başına servetinizin ${formatPercent(share, { decimals: 0 })} kadarı`,
      detail:
        `${formatMoney(asset.valueUsd)} değerindeki bu varlık ` +
        `eşiğin (${formatPercent(limit, { decimals: 0 })}) üzerinde. ` +
        `Bu varlıkta %30'luk bir düşüş toplam servetinizi ` +
        `${formatPercent(share.times("0.30"), { decimals: 1 })} azaltır.`,
      action: "Kademeli olarak azaltmayı veya yeni girişleri başka sınıflara yönlendirmeyi değerlendirin.",
      estimatedMonthlyGain: null,
      assetIds: [asset.assetId],
    }));
  },
};

/* ------------------------------------------------------------------ */
/* 9. Girişim runway uyarısı                                           */
/* ------------------------------------------------------------------ */

const burnAlert: Rule = {
  key: "burnAlert",
  label: "Girişim runway",
  evaluate(state) {
    const risky = state.ventures.filter((v) => v.alert !== "ok");
    if (risky.length === 0) return null;

    return risky.map((v): Opportunity => {
      const runway = v.runwayMonths ? new Decimal(v.runwayMonths) : null;
      const needed = Money.of(v.netMonthlyBurn, v.currency).times(6);

      return {
        id: `burnAlert:${v.assetId}`,
        ruleKey: "burnAlert",
        severity: v.alert === "critical" ? "critical" : "high",
        title: `${v.name} — ${runway ? `${formatNumber(runway, 1)} ay yakıt kaldı` : "nakit tükendi"}`,
        detail:
          `Aylık net yakım ${formatMoney(Money.of(v.netMonthlyBurn, v.currency), { compact: true })}, ` +
          `kasada ${formatMoney(Money.of(v.cashOnHand, v.currency), { compact: true })} var. ` +
          `Başabaşa ilerleme ` +
          `${v.breakevenProgress ? formatPercent(new Decimal(v.breakevenProgress), { decimals: 0 }) : "—"}. ` +
          `6 ay daha yaşatmak için ${formatMoney(needed, { compact: true })} gerekir.`,
        action:
          "Ya gideri kısın, ya geliri hızlandırın, ya da sermaye çağrısı planlayın. " +
          "Üçünü de yapmamak en pahalı seçenek.",
        estimatedMonthlyGain: null,
        assetIds: [v.assetId],
      };
    });
  },
};

/* ------------------------------------------------------------------ */
/* 10. Düşük kira verimi                                               */
/* ------------------------------------------------------------------ */

const lowYield: Rule = {
  key: "lowYield",
  label: "Düşük kira verimi",
  evaluate(state) {
    const out: Opportunity[] = [];
    const benchmark = bestAvailableNetRate(state);

    for (const p of state.properties) {
      if (!p.netYield) continue;
      const y = new Decimal(p.netYield);
      // Kira geliri yoksa bu kural değil, dormantAsset ilgilenir
      if (new Decimal(p.monthlyRent).isZero()) continue;
      if (y.greaterThanOrEqualTo(benchmark)) continue;

      const value = Money.of(p.currentValue, p.currency);
      const gap = benchmark.minus(y);

      out.push({
        id: `lowYield:${p.assetId}`,
        ruleKey: "lowYield",
        severity: "info",
        title: `${p.name} kira verimi mevduatın altında`,
        detail:
          `Net kira verimi ${formatPercent(y, { decimals: 2 })}, ` +
          `risksiz mevduat getirisi ${formatPercent(benchmark, { decimals: 2 })}. ` +
          `Aynı sermaye mevduatta olsaydı yılda ` +
          `${formatMoney(value.times(gap), { compact: true })} daha fazla getirirdi ` +
          `(değer artışı hariç).`,
        action:
          "Kirayı piyasa seviyesine güncelleyin, giderleri gözden geçirin veya " +
          "değer artışı beklentinizin bu farkı karşılayıp karşılamadığını değerlendirin.",
        estimatedMonthlyGain: null,
        assetIds: [p.assetId],
      });
    }
    return out;
  },
};

export const RULES: Rule[] = [
  idleCash,
  yieldArbitrage,
  dormantAsset,
  fxErosion,
  rebalance,
  taxHarvest,
  maturityRoll,
  concentrationRule,
  burnAlert,
  lowYield,
];
