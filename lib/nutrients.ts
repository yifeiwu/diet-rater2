/**
 * Source of truth for which nutrients we track + pure nutrient-aggregation
 * helpers. No IO, no React, no IDB.
 *
 * The UI talks exclusively to this module for anything related to nutrients,
 * Daily Values, or per-meal/day totals so that the rest of the app does not
 * have to know about NutrientKey/NutrientDef plumbing.
 *
 * Sources:
 * - FDC nutrient ids: https://fdc.nal.usda.gov/api-spec/fdc_api.html
 * - FDA Daily Values (2016, adults & children >= 4 yrs):
 *   https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels
 */

import { MEAL_SLOTS } from "./types";
import type {
  DailyPlan,
  Food,
  MealEntry,
  MealSlot,
  NutrientDef,
  NutrientKey,
  NutrientTotals,
  NutrientUnit,
} from "./types";

// --------------------------------------------------------------------------
// Definitions: NutrientKey <-> FDC id mapping + Daily Values.
// --------------------------------------------------------------------------

export const NUTRIENT_DEFS: readonly NutrientDef[] = [
  // Macros
  { key: "energy", label: "Calories", unit: "kcal", group: "macro", fdcIds: [1008, 2047, 2048], dailyValue: 2000 },
  { key: "protein", label: "Protein", unit: "g", group: "macro", fdcIds: [1003], dailyValue: 50 },
  { key: "fat", label: "Total Fat", unit: "g", group: "macro", fdcIds: [1004], dailyValue: 78 },
  { key: "carbs", label: "Carbohydrates", unit: "g", group: "macro", fdcIds: [1005, 1050], dailyValue: 275 },
  { key: "fiber", label: "Fiber", unit: "g", group: "macro", fdcIds: [1079, 2033], dailyValue: 28 },
  { key: "sugar", label: "Total Sugars", unit: "g", group: "macro", fdcIds: [2000, 1063] },
  { key: "addedSugar", label: "Added Sugars", unit: "g", group: "macro", fdcIds: [1235], dailyValue: 50 },
  { key: "satFat", label: "Saturated Fat", unit: "g", group: "macro", fdcIds: [1258], dailyValue: 20 },
  { key: "monoFat", label: "Monounsaturated Fat", unit: "g", group: "macro", fdcIds: [1292] },
  { key: "polyFat", label: "Polyunsaturated Fat", unit: "g", group: "macro", fdcIds: [1293] },
  { key: "transFat", label: "Trans Fat", unit: "g", group: "macro", fdcIds: [1257] },
  { key: "cholesterol", label: "Cholesterol", unit: "mg", group: "macro", fdcIds: [1253], dailyValue: 300 },
  { key: "water", label: "Water", unit: "g", group: "macro", fdcIds: [1051] },

  // Minerals
  { key: "sodium", label: "Sodium", unit: "mg", group: "mineral", fdcIds: [1093], dailyValue: 2300 },
  { key: "potassium", label: "Potassium", unit: "mg", group: "mineral", fdcIds: [1092], dailyValue: 4700 },
  { key: "calcium", label: "Calcium", unit: "mg", group: "mineral", fdcIds: [1087], dailyValue: 1300 },
  { key: "iron", label: "Iron", unit: "mg", group: "mineral", fdcIds: [1089], dailyValue: 18 },
  { key: "magnesium", label: "Magnesium", unit: "mg", group: "mineral", fdcIds: [1090], dailyValue: 420 },
  { key: "phosphorus", label: "Phosphorus", unit: "mg", group: "mineral", fdcIds: [1091], dailyValue: 1250 },
  { key: "zinc", label: "Zinc", unit: "mg", group: "mineral", fdcIds: [1095], dailyValue: 11 },
  { key: "copper", label: "Copper", unit: "mg", group: "mineral", fdcIds: [1098], dailyValue: 0.9 },
  { key: "manganese", label: "Manganese", unit: "mg", group: "mineral", fdcIds: [1101], dailyValue: 2.3 },
  { key: "selenium", label: "Selenium", unit: "µg", group: "mineral", fdcIds: [1103], dailyValue: 55 },

  // Vitamins
  { key: "vitA", label: "Vitamin A (RAE)", unit: "µg", group: "vitamin", fdcIds: [1106, 1104], dailyValue: 900 },
  { key: "vitC", label: "Vitamin C", unit: "mg", group: "vitamin", fdcIds: [1162], dailyValue: 90 },
  { key: "vitD", label: "Vitamin D (D2 + D3)", unit: "µg", group: "vitamin", fdcIds: [1114, 1110], dailyValue: 20 },
  { key: "vitE", label: "Vitamin E (alpha-toc)", unit: "mg", group: "vitamin", fdcIds: [1109, 1158], dailyValue: 15 },
  { key: "vitK", label: "Vitamin K", unit: "µg", group: "vitamin", fdcIds: [1185, 1183], dailyValue: 120 },
  { key: "thiamin", label: "Thiamin (B1)", unit: "mg", group: "vitamin", fdcIds: [1165], dailyValue: 1.2 },
  { key: "riboflavin", label: "Riboflavin (B2)", unit: "mg", group: "vitamin", fdcIds: [1166], dailyValue: 1.3 },
  { key: "niacin", label: "Niacin (B3)", unit: "mg", group: "vitamin", fdcIds: [1167], dailyValue: 16 },
  { key: "pantothenic", label: "Pantothenic acid (B5)", unit: "mg", group: "vitamin", fdcIds: [1170], dailyValue: 5 },
  { key: "vitB6", label: "Vitamin B6", unit: "mg", group: "vitamin", fdcIds: [1175], dailyValue: 1.7 },
  { key: "folate", label: "Folate (DFE)", unit: "µg", group: "vitamin", fdcIds: [1190, 1177], dailyValue: 400 },
  { key: "vitB12", label: "Vitamin B12", unit: "µg", group: "vitamin", fdcIds: [1178], dailyValue: 2.4 },
  { key: "choline", label: "Choline", unit: "mg", group: "vitamin", fdcIds: [1180], dailyValue: 550 },
];

// Lazy-built lookups so callers don't pay for them unless used.
let _fdcIdToKey: Map<number, NutrientKey> | null = null;
let _defByKey: Map<NutrientKey, NutrientDef> | null = null;

/** Map FDC nutrient id -> NutrientKey. First-listed id wins on collisions. */
export function fdcIdToKey(): Map<number, NutrientKey> {
  if (_fdcIdToKey) return _fdcIdToKey;
  const m = new Map<number, NutrientKey>();
  for (const def of NUTRIENT_DEFS) {
    for (const id of def.fdcIds) {
      if (!m.has(id)) m.set(id, def.key);
    }
  }
  _fdcIdToKey = m;
  return m;
}

/** Map NutrientKey -> NutrientDef (label, unit, dailyValue, etc.). */
export function defByKey(): Map<NutrientKey, NutrientDef> {
  if (_defByKey) return _defByKey;
  const m = new Map<NutrientKey, NutrientDef>();
  for (const def of NUTRIENT_DEFS) m.set(def.key, def);
  _defByKey = m;
  return m;
}

/** Macro keys in display order (subset of NutrientKey). */
export const MACRO_KEYS: readonly NutrientKey[] = NUTRIENT_DEFS.filter(
  (d) => d.group === "macro",
).map((d) => d.key);

/** Mineral keys in display order. */
export const MINERAL_KEYS: readonly NutrientKey[] = NUTRIENT_DEFS.filter(
  (d) => d.group === "mineral",
).map((d) => d.key);

/** Vitamin keys in display order. */
export const VITAMIN_KEYS: readonly NutrientKey[] = NUTRIENT_DEFS.filter(
  (d) => d.group === "vitamin",
).map((d) => d.key);

/**
 * Resolves the FDA Daily Value for a nutrient, honouring an optional per-plan
 * override map. Returns undefined when no DV is defined and no override is set.
 */
export function dailyValue(
  key: NutrientKey,
  override?: Partial<Record<NutrientKey, number>>,
): number | undefined {
  if (override) {
    const v = override[key];
    if (typeof v === "number") return v;
  }
  return defByKey().get(key)?.dailyValue;
}

/** Total grams represented by a meal entry. */
export function entryGrams(entry: MealEntry): number {
  return entry.gramWeight * entry.servings;
}

/**
 * Per-entry nutrient totals. Food nutrients are stored per 100 g, so we scale
 * by `grams / 100`. Returns an empty object when the food can't be resolved.
 */
export function entryTotals(
  entry: MealEntry,
  food: Food | undefined,
): NutrientTotals {
  if (!food) return {};
  const factor = entryGrams(entry) / 100;
  const out: NutrientTotals = {};
  for (const n of food.nutrients) {
    out[n.key] = n.amount * factor;
  }
  return out;
}

function addInto(target: NutrientTotals, src: NutrientTotals): void {
  for (const k of Object.keys(src) as NutrientKey[]) {
    const v = src[k];
    if (v === undefined) continue;
    target[k] = (target[k] ?? 0) + v;
  }
}

/** Totals across a single meal slot for the given plan. */
export function totalsForSlot(
  plan: DailyPlan,
  slot: MealSlot,
  foodsById: Map<number, Food>,
): NutrientTotals {
  const totals: NutrientTotals = {};
  const entries = plan.meals[slot];
  if (!entries) return totals;
  for (const entry of entries) {
    addInto(totals, entryTotals(entry, foodsById.get(entry.fdcId)));
  }
  return totals;
}

/** Totals across the whole day (every meal slot). */
export function totalsFor(
  plan: DailyPlan,
  foodsById: Map<number, Food>,
): NutrientTotals {
  const totals: NutrientTotals = {};
  for (const slot of MEAL_SLOTS) {
    addInto(totals, totalsForSlot(plan, slot, foodsById));
  }
  return totals;
}

/**
 * Kilocalorie breakdown by macronutrient. Atwater factors: protein/carbs = 4
 * kcal/g, fat = 9 kcal/g. `alcohol` is included in the return type for future
 * use but is never populated today (alcohol isn't a tracked NutrientKey).
 */
export function macroCalorieBreakdown(
  totals: NutrientTotals,
): { protein: number; carbs: number; fat: number; alcohol?: number } {
  const protein = (totals.protein ?? 0) * 4;
  const carbs = (totals.carbs ?? 0) * 4;
  const fat = (totals.fat ?? 0) * 9;
  return { protein, carbs, fat };
}

/**
 * Formats a nutrient amount for display.
 *
 *   kcal -> integer
 *   g    -> 1 decimal place if < 10, otherwise integer
 *   mg   -> integer
 *   µg   -> integer
 */
export function formatAmount(amount: number, unit: NutrientUnit): string {
  switch (unit) {
    case "kcal":
      return `${Math.round(amount)}`;
    case "g":
      return amount < 10 ? amount.toFixed(1) : `${Math.round(amount)}`;
    case "mg":
      return `${Math.round(amount)}`;
    case "µg":
      return `${Math.round(amount)}`;
  }
}

/**
 * % Daily Value, rounded to 1 decimal place. Returns undefined when the
 * nutrient has no defined DV (and no override supplies one).
 */
export function percentDV(
  amount: number,
  key: NutrientKey,
  override?: Partial<Record<NutrientKey, number>>,
): number | undefined {
  const dv = dailyValue(key, override);
  if (dv === undefined || dv === 0) return undefined;
  return Math.round((amount / dv) * 1000) / 10;
}
