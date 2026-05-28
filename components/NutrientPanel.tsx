"use client";

/**
 * NutrientPanel — visual nutrient summary for a DailyPlan.
 *
 * Sections (top to bottom):
 *   1. Calorie ring + macro pie (side-by-side on md+)
 *   2. Macros bars (MACRO_KEYS minus "energy")
 *   3. Minerals + Vitamins sub-cards (side-by-side on lg+)
 *
 * Aggregation is delegated to lib/nutrients; this component is purely
 * presentational and safe to render with an empty plan. Daily Values are
 * read from `plan.targets` if present, otherwise from the FDA defaults.
 */

import { memo, useMemo } from "react";
import {
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import type {
  DailyPlan,
  Food,
  NutrientKey,
  NutrientTotals,
} from "@/lib/types";
import {
  MACRO_KEYS,
  MINERAL_KEYS,
  VITAMIN_KEYS,
  dailyValue,
  defByKey,
  formatAmount,
  macroCalorieBreakdown,
  percentDV,
  totalsFor,
} from "@/lib/nutrients";

interface NutrientPanelProps {
  /** Current plan to summarize. */
  plan: DailyPlan;
  /** Food lookup map keyed by fdcId. The parent (Phase 3) maintains this. */
  foodsById: Map<number, Food>;
}

type TargetMap = Partial<Record<NutrientKey, number>> | undefined;

// Nutrients where exceeding the DV is a negative signal (shown in red).
const LIMIT_KEYS: ReadonlySet<NutrientKey> = new Set<NutrientKey>([
  "sodium", "satFat", "addedSugar", "cholesterol", "transFat",
]);

const COLORS = {
  accent: "#5eead4",
  warm: "#fbbf24",
  protein: "#5eead4",
  carbs: "#a78bfa",
  fat: "#fbbf24",
  alcohol: "#fb7185",
} as const;

const TOOLTIP_CONTENT_STYLE = {
  background: "#161d33",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  color: "#e2e8f0",
} as const;
const TOOLTIP_LABEL_STYLE = { color: "#94a3b8" } as const;

export default function NutrientPanel({
  plan,
  foodsById,
}: NutrientPanelProps): JSX.Element {
  const totals = useMemo(() => totalsFor(plan, foodsById), [plan, foodsById]);
  const macroKcal = useMemo(() => macroCalorieBreakdown(totals), [totals]);

  const kcal = totals.energy ?? 0;
  const target = dailyValue("energy", plan.targets) ?? 2000;

  return (
    <div className="card p-4 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CalorieRing kcal={kcal} target={target} />
        <MacroPie macroKcal={macroKcal} />
      </div>

      <section>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Macros</h3>
        <div className="space-y-2">
          {MACRO_KEYS.filter((k) => k !== "energy").map((k) => (
            <NutrientRow
              key={k}
              k={k}
              amount={totals[k] ?? 0}
              targets={plan.targets}
              compact={false}
            />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NutrientSubPanel
          title="Minerals"
          keys={MINERAL_KEYS}
          totals={totals}
          targets={plan.targets}
        />
        <NutrientSubPanel
          title="Vitamins"
          keys={VITAMIN_KEYS}
          totals={totals}
          targets={plan.targets}
        />
      </div>
    </div>
  );
}

// --- Calorie ring ---------------------------------------------------------

function CalorieRing({ kcal, target }: { kcal: number; target: number }): JSX.Element {
  const safeTarget = target > 0 ? target : 1;
  const color = kcal / safeTarget > 1 ? COLORS.warm : COLORS.accent;
  const display = Math.max(0, Math.min(kcal, safeTarget));
  const data = [{ name: "kcal", value: display, fill: color }];

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={200}>
        <RadialBarChart
          innerRadius={70}
          outerRadius={100}
          startAngle={90}
          endAngle={-270}
          data={data}
        >
          <PolarAngleAxis type="number" domain={[0, safeTarget]} tick={false} angleAxisId={0} />
          <RadialBar
            background={{ fill: "rgba(255,255,255,0.06)" }}
            dataKey="value"
            cornerRadius={8}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-3xl font-semibold text-slate-100 tabular-nums">
          {Math.round(kcal)}
        </span>
        <span className="text-xs text-slate-400 tabular-nums">
          / {Math.round(target)} kcal
        </span>
      </div>
    </div>
  );
}

// --- Macro pie ------------------------------------------------------------

interface MacroBreakdown {
  protein: number;
  carbs: number;
  fat: number;
  alcohol?: number;
}

interface MacroSlice {
  name: string;
  value: number;
  color: string;
  grams: number;
}

function buildMacroSlices(m: MacroBreakdown): MacroSlice[] {
  const slices: MacroSlice[] = [
    { name: "Protein", value: m.protein, color: COLORS.protein, grams: m.protein / 4 },
    { name: "Carbs", value: m.carbs, color: COLORS.carbs, grams: m.carbs / 4 },
    { name: "Fat", value: m.fat, color: COLORS.fat, grams: m.fat / 9 },
  ];
  if (m.alcohol && m.alcohol > 0) {
    slices.push({ name: "Alcohol", value: m.alcohol, color: COLORS.alcohol, grams: m.alcohol / 7 });
  }
  return slices;
}

function MacroPie({ macroKcal }: { macroKcal: MacroBreakdown }): JSX.Element {
  const total =
    macroKcal.protein + macroKcal.carbs + macroKcal.fat + (macroKcal.alcohol ?? 0);

  if (!Number.isFinite(total) || total <= 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={[{ name: "empty", value: 1 }]}
              dataKey="value"
              innerRadius={40}
              outerRadius={80}
              isAnimationActive={false}
              stroke="none"
            >
              <Cell fill="rgba(255,255,255,0.06)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-500">Add foods to see your macro split</p>
      </div>
    );
  }

  const slices = buildMacroSlices(macroKcal);

  return (
    <div className="flex flex-col items-center gap-2">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius={40}
            outerRadius={80}
            isAnimationActive={false}
            stroke="none"
            paddingAngle={2}
          >
            {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={(value, name) => [`${Math.round(Number(value))} kcal`, String(name)]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="text-xs text-slate-300 flex flex-wrap justify-center gap-x-3 gap-y-1 px-2">
        {slices.map((s) => {
          const pct = Math.round((s.value / total) * 100);
          return (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="text-slate-400">{s.name.toLowerCase()}</span>
              <span className="tabular-nums">{formatAmount(s.grams, "g")}g</span>
              <span className="text-slate-500">·</span>
              <span className="tabular-nums">{pct}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// --- Sub-card with a list of nutrient rows -------------------------------

function NutrientSubPanel({
  title,
  keys,
  totals,
  targets,
}: {
  title: string;
  keys: readonly NutrientKey[];
  totals: NutrientTotals;
  targets: TargetMap;
}): JSX.Element {
  return (
    <section className="bg-bg-soft/50 ring-1 ring-white/5 rounded-xl p-3">
      <h3 className="text-sm font-semibold text-slate-200 mb-2">{title}</h3>
      <div className="space-y-1.5">
        {keys.map((k) => (
          <NutrientRow
            key={k}
            k={k}
            amount={totals[k] ?? 0}
            targets={targets}
            compact
          />
        ))}
      </div>
    </section>
  );
}

// --- Single nutrient row -------------------------------------------------

interface NutrientRowProps {
  k: NutrientKey;
  amount: number;
  targets: TargetMap;
  compact: boolean;
}

interface RowVisual {
  textCls: string;
  barCls: string;
  widthPct: number;
}

function rowVisual(pct: number | undefined, isLimit: boolean): RowVisual {
  if (pct === undefined) {
    return { textCls: "text-slate-400", barCls: "bg-slate-500/40", widthPct: 0 };
  }
  // Bar maxes out at 200 % DV.
  const widthPct = Math.min(Math.max(pct, 0), 200) / 2;
  if (pct < 50) return { textCls: "text-slate-400", barCls: "bg-slate-500/40", widthPct };
  if (pct <= 100) return { textCls: "text-accent", barCls: "bg-accent/70", widthPct };
  if (isLimit) return { textCls: "text-accent-danger", barCls: "bg-accent-danger/70", widthPct };
  return { textCls: "text-accent-warm", barCls: "bg-accent-warm/70", widthPct };
}

const NutrientRow = memo(function NutrientRow({
  k, amount, targets, compact,
}: NutrientRowProps): JSX.Element {
  const def = defByKey().get(k);
  const pct = percentDV(amount, k, targets);
  const isLimit = LIMIT_KEYS.has(k);

  const visual = useMemo(() => rowVisual(pct, isLimit), [pct, isLimit]);

  const labelText = def?.label ?? k;
  const unit = def?.unit ?? "g";

  const labelSize = compact ? "text-xs" : "text-sm";
  const amountSize = compact ? "text-[11px]" : "text-xs";
  const labelWidth = compact ? "w-24" : "w-28";
  const barHeight = compact ? "h-1.5" : "h-2";

  return (
    <div className={`flex items-center gap-2 min-w-0 ${labelSize}`}>
      <span className={`${labelWidth} shrink-0 truncate text-left text-slate-200`}>
        {labelText}
      </span>

      <div
        className={`relative flex-1 min-w-0 rounded-full bg-white/5 overflow-hidden ${barHeight}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={200}
        aria-valuenow={pct ?? 0}
        aria-label={`${labelText} percent of daily value`}
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${visual.barCls}`}
          style={{ width: `${visual.widthPct}%` }}
        />
      </div>

      <div className={`shrink-0 inline-flex items-center gap-1 tabular-nums ${amountSize} ${visual.textCls}`}>
        <span>
          {formatAmount(amount, unit)}
          <span className="text-slate-500 ml-0.5">{unit}</span>
        </span>
        <span className="text-slate-500">·</span>
        <span className="min-w-[2.6rem] text-right">
          {pct !== undefined ? `${pct}%` : "—"}
        </span>
      </div>
    </div>
  );
});
