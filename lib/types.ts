/**
 * Shared types frozen at the start of Phase 1.
 * Both the data-pipeline (scripts/) and the client lib (lib/) consume these.
 * Do NOT reshape Food / DailyPlan / Meta without coordinating both sides.
 */

/** FDC dataType values we ingest. */
export type FoodDataType = "Foundation" | "Survey (FNDDS)";

/** Stable string keys used everywhere except inside the FDC dataset itself. */
export type NutrientKey =
  // macros
  | "energy"
  | "protein"
  | "fat"
  | "carbs"
  | "fiber"
  | "sugar"
  | "addedSugar"
  | "satFat"
  | "monoFat"
  | "polyFat"
  | "transFat"
  | "cholesterol"
  | "water"
  // minerals
  | "sodium"
  | "potassium"
  | "calcium"
  | "iron"
  | "magnesium"
  | "phosphorus"
  | "zinc"
  | "copper"
  | "manganese"
  | "selenium"
  // vitamins
  | "vitA"
  | "vitC"
  | "vitD"
  | "vitE"
  | "vitK"
  | "thiamin"
  | "riboflavin"
  | "niacin"
  | "pantothenic"
  | "vitB6"
  | "folate"
  | "vitB12"
  | "choline";

export type NutrientUnit = "kcal" | "g" | "mg" | "µg";

export type NutrientGroup = "macro" | "mineral" | "vitamin";

export interface NutrientDef {
  /** Stable key. */
  key: NutrientKey;
  /** Display label. */
  label: string;
  /** Storage / display unit. All amounts in `Food.nutrients` are in this unit. */
  unit: NutrientUnit;
  /** Source FDC nutrient ids (in priority order). */
  fdcIds: number[];
  /** UI grouping. */
  group: NutrientGroup;
  /** FDA Daily Value (adult, 2000 kcal reference). undefined = no official DV. */
  dailyValue?: number;
}

/** A single normalized nutrient amount on a food, expressed per 100 g of food. */
export interface FoodNutrient {
  /** NutrientKey, but stored as the raw key string for compactness in JSON. */
  key: NutrientKey;
  /** Amount per 100 g of the food, in the unit dictated by the matching NutrientDef. */
  amount: number;
}

export interface FoodPortion {
  /** Human-readable, e.g. "1 cup" or "1 medium (118 g)". */
  description: string;
  /** Resolved gram weight for this portion (always in grams). */
  gramWeight: number;
}

export interface Food {
  /** FDC fdcId, used as IndexedDB key. */
  id: number;
  name: string;
  dataType: FoodDataType;
  category?: string;
  /** Nutrient amounts per 100 g of food. Only includes nutrients in NutrientKey. */
  nutrients: FoodNutrient[];
  /** Always includes a synthetic "100 g" portion. */
  portions: FoodPortion[];
}

/** A single line in a meal. */
export interface MealEntry {
  /** Stable client-side id (nanoid). */
  id: string;
  fdcId: number;
  /** Denormalized for fast UI rendering without an IDB lookup. */
  name: string;
  portionDescription: string;
  /** Grams that this single portion represents. */
  gramWeight: number;
  /** Multiplier on `gramWeight` (e.g. 2 servings of "1 cup"). */
  servings: number;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snacks";

export const MEAL_SLOTS: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snacks",
] as const;

export interface DailyPlan {
  /** YYYY-MM-DD, used as IDB key. */
  date: string;
  meals: Record<MealSlot, MealEntry[]>;
  /**
   * Optional user override of Daily Values.
   * Missing keys fall back to NutrientDef.dailyValue.
   */
  targets?: Partial<Record<NutrientKey, number>>;
}

/** Aggregated nutrient totals for a meal / day. Always in NutrientDef units. */
export type NutrientTotals = Partial<Record<NutrientKey, number>>;

/** Single row written by the build script and read on every app load. */
export interface DataMeta {
  /** Bumped whenever the underlying USDA dataset is re-extracted. */
  version: string;
  generatedAt: string;
  foundationCount: number;
  surveyCount: number;
  totalCount: number;
}

/** IDB meta row (single row, key = "fdc"). */
export interface IdbMetaRow {
  key: "fdc";
  version: string;
  loadedAt: string;
}
