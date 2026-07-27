import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goals } from "@/db/schema";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { computeNetWorth } from "@/lib/valuation";
import { analyzeGoal, type GoalProgress } from "@/lib/finance/goals";

/**
 * Hedeflerin DB katmanı ve ilerleme hesabı.
 *
 * `lib/finance/goals.ts` saf matematik; burası onu veriye bağlar.
 */

export interface GoalInput {
  id?: string;
  name: string;
  targetAmount: string;
  currency: string;
  targetDate: string;
  kind: "retirement" | "property" | "education" | "emergency" | "other";
  priority: number;
  countKinds?: string[];
  note?: string | null;
}

export function saveGoal(input: GoalInput): string {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  const values = {
    name: input.name,
    targetAmount: input.targetAmount,
    currency: input.currency,
    targetDate: input.targetDate,
    kind: input.kind,
    priority: input.priority,
    countKinds: input.countKinds ?? [],
    note: input.note ?? null,
    updatedAt: now,
  };

  const existing = input.id
    ? db.select().from(goals).where(eq(goals.id, input.id)).get()
    : undefined;

  if (existing) {
    db.update(goals).set(values).where(eq(goals.id, id)).run();
  } else {
    db.insert(goals).values({ id, ...values, createdAt: now }).run();
  }
  return id;
}

export function deleteGoal(id: string): void {
  db.delete(goals).where(eq(goals.id, id)).run();
}

export interface GoalView {
  id: string;
  name: string;
  kind: string;
  priority: number;
  targetAmount: string;
  currency: string;
  targetDate: string;
  /** Hedefe sayılan varlıkların bugünkü USD değeri. */
  currentUsd: string;
  targetUsd: string;
  yearsRemaining: number;
  progress: GoalProgress;
  countKinds: string[];
  note: string | null;
}

const MS_PER_YEAR = 365.25 * 86_400_000;

/**
 * Tüm hedefleri ilerlemeleriyle döner.
 *
 * `countKinds` boşsa net servetin tamamı sayılır. Dolu ise yalnızca o
 * varlık türleri — "ev peşinatı" hedefinde emeklilik fonunu saymak
 * kendinizi olduğunuzdan hazır sanmanıza yol açar.
 */
export async function loadGoals(now = new Date()): Promise<GoalView[]> {
  const rows = db.select().from(goals).all();
  if (rows.length === 0) return [];

  const [nw, fx] = await Promise.all([computeNetWorth(), getFx()]);

  const toUsd = (m: Money): Money =>
    fx.converter.has(m.currency) ? fx.converter.toBase(m) : Money.zero("USD");

  return rows
    .map((row) => {
      const kinds = row.countKinds ?? [];
      const currentUsd =
        kinds.length === 0
          ? nw.totalUsd
          : nw.assets
              .filter((a) => kinds.includes(a.kind))
              .reduce((acc, a) => acc.plus(a.valueUsd), Money.zero("USD"));

      const targetUsd = toUsd(Money.of(row.targetAmount, row.currency));

      const yearsRemaining =
        (new Date(row.targetDate).getTime() - now.getTime()) / MS_PER_YEAR;

      const progress = analyzeGoal({
        targetAmount: new Decimal(targetUsd.toDb()),
        currentValue: new Decimal(currentUsd.toDb()),
        yearsRemaining,
      });

      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        priority: row.priority,
        targetAmount: row.targetAmount,
        currency: row.currency,
        targetDate: row.targetDate,
        currentUsd: currentUsd.toDb(),
        targetUsd: targetUsd.toDb(),
        yearsRemaining: Math.round(yearsRemaining * 10) / 10,
        progress,
        countKinds: kinds,
        note: row.note,
      };
    })
    .sort((a, b) => a.priority - b.priority || a.targetDate.localeCompare(b.targetDate));
}
