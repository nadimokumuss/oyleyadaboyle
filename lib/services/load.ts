import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assets, transactions, deposits, properties, vehicles, ventures,
} from "@/db/schema";
import { computePosition } from "@/lib/finance/costbasis";

/**
 * Düzenleme formlarını dolduran okuma katmanı.
 *
 * Formlar düz string bekliyor (HTML input değerleri string'tir), o
 * yüzden burada Money/Decimal'a çevrilmiyor — doğrudan DB'deki ondalık
 * string'ler geçiriliyor.
 */

type FormKind =
  | "cash" | "position" | "deposit" | "property" | "vehicle" | "venture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadAssetDefaults(id: string, kind: FormKind): any {
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) return {};

  const base = {
    id: asset.id,
    name: asset.name,
    currency: asset.currency,
    country: asset.country ?? "",
    status: asset.status,
    note: asset.note ?? "",
  };

  switch (kind) {
    case "cash": {
      const tx = db.select().from(transactions).where(eq(transactions.assetId, id)).all();
      const position = computePosition(id, asset.currency, tx);
      const net = position.totalCost
        .plus(position.incomeReceived)
        .minus(position.costsPaid);
      return { ...base, amount: net.toDb() };
    }

    case "position": {
      const tx = db.select().from(transactions).where(eq(transactions.assetId, id)).all();
      const buy = tx.find((t) => t.type === "buy");
      const position = computePosition(id, asset.currency, tx);
      return {
        ...base,
        kind: asset.kind,
        symbol: asset.symbol ?? "",
        quantity: position.quantity.toFixed(),
        pricePerUnit: buy?.pricePerUnit ?? position.wacPerUnit.toDb(),
        purchaseDate: buy?.date ?? "",
        fee: buy?.fee ?? "",
      };
    }

    case "deposit": {
      const d = db.select().from(deposits).where(eq(deposits.assetId, id)).get();
      if (!d) return base;
      return {
        ...base,
        principal: d.principal,
        annualRate: d.annualRate,
        compounding: d.compounding,
        dayCount: d.dayCount,
        startDate: d.startDate,
        maturityDate: d.maturityDate ?? "",
      };
    }

    case "property": {
      const p = db.select().from(properties).where(eq(properties.assetId, id)).get();
      if (!p) return base;
      const costs = p.monthlyCosts ?? {};
      return {
        ...base,
        city: p.city,
        country: p.country,
        addressLine: p.addressLine ?? "",
        lat: p.lat,
        lng: p.lng,
        purchasePrice: p.purchasePrice,
        purchaseDate: p.purchaseDate,
        closingCosts: p.closingCosts ?? "",
        renovationCost: p.renovationCost ?? "",
        indexKey: p.indexKey ?? "",
        manualValue: p.manualValue ?? "",
        monthlyRent: p.monthlyRent ?? "",
        occupancyRate: p.occupancyRate ?? "1",
        hoa: costs.hoa ?? "",
        propertyTax: costs.tax ?? "",
        insurance: costs.insurance ?? "",
        maintenance: costs.maintenance ?? "",
      };
    }

    case "vehicle": {
      const v = db.select().from(vehicles).where(eq(vehicles.assetId, id)).get();
      if (!v) return base;
      const costs = v.annualCosts ?? {};
      return {
        ...base,
        make: v.make,
        model: v.model,
        year: v.year,
        odometer: v.odometer ?? 0,
        country: v.country,
        segment: v.segment,
        purchasePrice: v.purchasePrice,
        purchaseDate: v.purchaseDate,
        manualValue: v.manualValue ?? "",
        insurance: costs.insurance ?? "",
        tax: costs.tax ?? "",
        maintenance: costs.maintenance ?? "",
        fuel: costs.fuel ?? "",
      };
    }

    case "venture": {
      const v = db.select().from(ventures).where(eq(ventures.assetId, id)).get();
      if (!v) return base;
      return {
        ...base,
        legalName: v.legalName,
        country: v.country,
        sector: v.sector ?? "",
        stage: v.stage ?? "",
        ownershipPct: v.ownershipPct,
        committedCapital: v.committedCapital,
        calledCapital: v.calledCapital ?? "",
        valuation: v.valuation ?? "",
        valuationDate: v.valuationDate ?? "",
        monthlyRevenue: v.monthlyRevenue ?? "",
        monthlyBurn: v.monthlyBurn ?? "",
        cashOnHand: v.cashOnHand ?? "",
      };
    }

    default:
      return base;
  }
}
