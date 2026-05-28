/**
 * Build the static diet-rater dataset under `public/data/`.
 *
 * Pipeline:
 *   1. Download Foundation + Survey/FNDDS JSON ZIPs from USDA FoodData
 *      Central (cached under scripts/.cache/).
 *   2. Extract each ZIP's inner JSON to disk, JSON.parse it, and normalize
 *      each raw food record into the `Food` shape from `lib/types.ts`.
 *      Nutrient ids are filtered through `fdcIdToKey()` from
 *      `lib/nutrients.ts`, so the on-disk dataset is the canonical
 *      tracked-nutrient list and nothing else.
 *   3. Sort by name, write `foods.json`, `meta.json`, and a resolved
 *      `demo-plan.json` for first-run users.
 *
 * Run via `npm run build:data` from the project root.
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { fdcIdToKey } from "../lib/nutrients";
import type {
  DataMeta,
  Food,
  FoodDataType,
  FoodNutrient,
  FoodPortion,
  MealEntry,
  MealSlot,
} from "../lib/types";
import { downloadIfMissing, extractZipJson, formatBytes } from "./fetch-fdc";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const FOUNDATION_DATE = "2026-04-30";
const SURVEY_DATE = "2024-10-31";

const FOUNDATION_URL = `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_${FOUNDATION_DATE}.zip`;
const SURVEY_URL = `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_${SURVEY_DATE}.zip`;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const CACHE_DIR = path.join(SCRIPT_DIR, ".cache");
const DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const FOODS_PATH = path.join(DATA_DIR, "foods.json");
const META_PATH = path.join(DATA_DIR, "meta.json");
const DEMO_PLAN_PATH = path.join(DATA_DIR, "demo-plan.json");

// --------------------------------------------------------------------------
// Minimal raw FDC types (only the fields we touch).
// --------------------------------------------------------------------------

interface RawNutrient {
  id?: number;
  number?: string;
  name?: string;
}

interface RawFoodNutrient {
  amount?: number;
  nutrientId?: number;
  nutrient?: RawNutrient;
  nutrientNumber?: string;
}

interface RawMeasureUnit {
  name?: string;
  abbreviation?: string;
}

interface RawFoodPortion {
  portionDescription?: string;
  modifier?: string;
  measureUnit?: RawMeasureUnit;
  amount?: number;
  gramWeight?: number;
}

interface RawFoundationItem {
  fdcId: number;
  description?: string;
  foodCategory?: { description?: string };
  foodNutrients?: RawFoodNutrient[];
  foodPortions?: RawFoodPortion[];
}

interface RawSurveyItem {
  fdcId: number;
  description?: string;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients?: RawFoodNutrient[];
  foodPortions?: RawFoodPortion[];
}

// --------------------------------------------------------------------------
// Per-run stats (printed at the end so users can sanity-check the dataset).
// --------------------------------------------------------------------------

interface IngestStats {
  raw: number;
  kept: number;
  skippedNoNutrients: number;
  skippedNoFdcId: number;
  withZeroPortionsSource: number;
}

function newStats(): IngestStats {
  return {
    raw: 0,
    kept: 0,
    skippedNoNutrients: 0,
    skippedNoFdcId: 0,
    withZeroPortionsSource: 0,
  };
}

// --------------------------------------------------------------------------
// Normalization
// --------------------------------------------------------------------------

const ID_TO_KEY = fdcIdToKey();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * USDA JSON files are shaped `{ "FoundationFoods": [...] }` or
 * `{ "SurveyFoods": [...] }`. Pick the first array-valued top-level property.
 */
function pickItemArray(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) {
    throw new Error("Top-level JSON is neither an array nor an object");
  }
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) return value;
  }
  throw new Error("Top-level JSON has no array-valued property");
}

function resolveNutrientFdcId(raw: RawFoodNutrient): number | undefined {
  if (typeof raw.nutrient?.id === "number") return raw.nutrient.id;
  if (typeof raw.nutrientId === "number") return raw.nutrientId;
  return undefined;
}

function buildNutrients(raw: RawFoodNutrient[] | undefined): FoodNutrient[] {
  if (!raw || raw.length === 0) return [];
  // De-dup by key: if FDC ships multiple entries for the same nutrient (e.g.
  // both fdcIds 1008 and 2048 for energy), keep the first non-zero amount.
  const byKey = new Map<FoodNutrient["key"], number>();
  for (const entry of raw) {
    const fdcId = resolveNutrientFdcId(entry);
    if (fdcId == null) continue;
    const key = ID_TO_KEY.get(fdcId);
    if (!key) continue;
    const amount = typeof entry.amount === "number" ? entry.amount : 0;
    if (!byKey.has(key)) {
      byKey.set(key, amount);
    } else if (byKey.get(key) === 0 && amount !== 0) {
      byKey.set(key, amount);
    }
  }
  const out: FoodNutrient[] = [];
  for (const [key, amount] of byKey) {
    out.push({ key, amount });
  }
  return out;
}

function describePortion(raw: RawFoodPortion): string {
  const portion = raw.portionDescription?.trim();
  if (portion) return portion;

  const modifier = raw.modifier?.trim();
  const unitName =
    raw.measureUnit?.name?.trim() || raw.measureUnit?.abbreviation?.trim() || "";

  // Skip placeholder USDA strings.
  const unit = unitName === "Undetermined" || unitName === "undetermined" ? "" : unitName;

  const amount = typeof raw.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : undefined;
  const amountStr = amount != null ? formatAmount(amount) : "";

  if (modifier) {
    return amountStr ? `${amountStr} ${modifier}`.trim() : modifier;
  }
  if (unit) {
    return amountStr ? `${amountStr} ${unit}`.trim() : unit;
  }
  return "1 portion";
}

function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Trim trailing zeros, keep up to 3 decimals.
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function buildPortions(raw: RawFoodPortion[] | undefined): FoodPortion[] {
  const portions: FoodPortion[] = [];
  const seen = new Set<string>();
  const push = (portion: FoodPortion) => {
    const key = `${portion.description}\u0000${portion.gramWeight}`;
    if (seen.has(key)) return;
    seen.add(key);
    portions.push(portion);
  };
  push({ description: "100 g", gramWeight: 100 });
  if (raw) {
    for (const entry of raw) {
      const gramWeight = typeof entry.gramWeight === "number" ? entry.gramWeight : NaN;
      if (!Number.isFinite(gramWeight) || gramWeight <= 0) continue;
      const description = describePortion(entry);
      push({ description, gramWeight });
    }
  }
  return portions;
}

function normalizeFoundation(raw: RawFoundationItem, stats: IngestStats): Food | null {
  return normalizeCommon(
    raw.fdcId,
    raw.description,
    "Foundation",
    raw.foodCategory?.description,
    raw.foodNutrients,
    raw.foodPortions,
    stats,
  );
}

function normalizeSurvey(raw: RawSurveyItem, stats: IngestStats): Food | null {
  return normalizeCommon(
    raw.fdcId,
    raw.description,
    "Survey (FNDDS)",
    raw.wweiaFoodCategory?.wweiaFoodCategoryDescription,
    raw.foodNutrients,
    raw.foodPortions,
    stats,
  );
}

function normalizeCommon(
  fdcId: number | undefined,
  description: string | undefined,
  dataType: FoodDataType,
  category: string | undefined,
  rawNutrients: RawFoodNutrient[] | undefined,
  rawPortions: RawFoodPortion[] | undefined,
  stats: IngestStats,
): Food | null {
  stats.raw++;
  if (typeof fdcId !== "number") {
    stats.skippedNoFdcId++;
    return null;
  }
  const nutrients = buildNutrients(rawNutrients);
  if (nutrients.length === 0) {
    stats.skippedNoNutrients++;
    return null;
  }
  const portions = buildPortions(rawPortions);
  if (portions.length === 1) {
    // Only the synthetic 100 g portion survived.
    stats.withZeroPortionsSource++;
  }
  const food: Food = {
    id: fdcId,
    name: (description ?? "").trim() || `FDC ${fdcId}`,
    dataType,
    nutrients,
    portions,
  };
  if (category && category.trim()) {
    food.category = category.trim();
  }
  stats.kept++;
  return food;
}

// --------------------------------------------------------------------------
// Single foods.json output
// --------------------------------------------------------------------------

async function writeFoodsJson(foods: Food[]): Promise<number> {
  const body = JSON.stringify(foods);
  await fs.writeFile(FOODS_PATH, body);
  return body.length;
}

// --------------------------------------------------------------------------
// Demo plan resolver
// --------------------------------------------------------------------------

interface DemoSpec {
  /** Whitespace-separated query words; ALL must appear in the food name. */
  query: string;
  /** Preferred portion description substrings, tried in order. */
  portionPreference?: string[];
  /** Fallback grams if no portion matches. The synthetic 100 g is always present. */
  customGrams?: number;
  /** Servings multiplier. Defaults to 1. */
  servings?: number;
}

const DEMO_SPECS: Record<MealSlot, DemoSpec[]> = {
  breakfast: [
    { query: "oats raw", customGrams: 50 },
    { query: "banana raw", portionPreference: ["1 medium", "medium"] },
    { query: "milk reduced fat 2", portionPreference: ["1 cup", "cup"] },
  ],
  lunch: [
    { query: "chicken breast skinless boneless cooked", customGrams: 120 },
    { query: "rice brown cooked no added", portionPreference: ["1 cup", "cup"] },
    { query: "broccoli fresh no added", portionPreference: ["1 cup", "cup"] },
  ],
  dinner: [
    { query: "salmon broiled", customGrams: 120 },
    { query: "sweet potato baked no added", portionPreference: ["1 medium", "medium"] },
    { query: "spinach fresh no added", portionPreference: ["1 cup", "cup"] },
  ],
  snacks: [
    { query: "almonds raw", customGrams: 28 },
    { query: "apple raw", portionPreference: ["1 medium", "medium"] },
  ],
};

/**
 * Picks the cleanest food whose name contains every query word.
 * Heuristic: prefer Foundation > Survey; among those, prefer shorter names
 * (proxy for fewer USDA qualifiers like "with butter" or "fat added").
 */
function findDemoFood(query: string, foods: Food[]): Food | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let best: Food | null = null;
  let bestScore = -Infinity;

  for (const food of foods) {
    const name = food.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;

    // Higher is better.
    const lengthPenalty = -name.length / 10;
    const dataTypeBonus = food.dataType === "Foundation" ? 5 : 0;
    // Bonus if the first word of the food name matches the first query word.
    const firstWordBonus = name.startsWith(words[0]) ? 3 : 0;
    const score = lengthPenalty + dataTypeBonus + firstWordBonus;

    if (score > bestScore) {
      bestScore = score;
      best = food;
    }
  }
  return best;
}

function pickPortion(food: Food, spec: DemoSpec): FoodPortion {
  if (spec.portionPreference) {
    for (const pref of spec.portionPreference) {
      const lower = pref.toLowerCase();
      const match = food.portions.find((p) => p.description.toLowerCase().includes(lower));
      if (match) return match;
    }
  }
  if (spec.customGrams) {
    return { description: `${spec.customGrams} g`, gramWeight: spec.customGrams };
  }
  return food.portions.find((p) => p.description !== "100 g") ?? food.portions[0];
}

interface DemoPlanFile {
  /** Tied to the dataset version so stale demos invalidate cleanly. */
  version: string;
  meals: Record<MealSlot, Omit<MealEntry, "id">[]>;
}

function buildDemoPlan(foods: Food[], version: string): {
  file: DemoPlanFile;
  unresolved: { slot: MealSlot; query: string }[];
} {
  const meals = {} as DemoPlanFile["meals"];
  const unresolved: { slot: MealSlot; query: string }[] = [];

  for (const [slot, specs] of Object.entries(DEMO_SPECS) as [MealSlot, DemoSpec[]][]) {
    const entries: Omit<MealEntry, "id">[] = [];
    for (const spec of specs) {
      const food = findDemoFood(spec.query, foods);
      if (!food) {
        unresolved.push({ slot, query: spec.query });
        continue;
      }
      const portion = pickPortion(food, spec);
      entries.push({
        fdcId: food.id,
        name: food.name,
        portionDescription: portion.description,
        gramWeight: portion.gramWeight,
        servings: spec.servings ?? 1,
      });
    }
    meals[slot] = entries;
  }
  return { file: { version, meals }, unresolved };
}

async function writeDemoPlan(file: DemoPlanFile): Promise<number> {
  const body = JSON.stringify(file, null, 2) + "\n";
  await fs.writeFile(DEMO_PLAN_PATH, body);
  return body.length;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

async function totalDataDirBytes(): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    }
  };
  await walk(DATA_DIR);
  return total;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });

  const foundationZip = path.join(
    CACHE_DIR,
    `foundation_${FOUNDATION_DATE}.zip`,
  );
  const surveyZip = path.join(CACHE_DIR, `survey_${SURVEY_DATE}.zip`);

  await downloadIfMissing(FOUNDATION_URL, foundationZip, "Foundation");
  await downloadIfMissing(SURVEY_URL, surveyZip, "Survey (FNDDS)");

  const foundationJsonPath = path.join(CACHE_DIR, `foundation_${FOUNDATION_DATE}.json`);
  const surveyJsonPath = path.join(CACHE_DIR, `survey_${SURVEY_DATE}.json`);

  const foods: Food[] = [];
  const stats = newStats();

  console.log(`[ingest] extracting Foundation from ${path.basename(foundationZip)} ...`);
  const tFoundation = Date.now();
  const foundationEntry = await extractZipJson(foundationZip, foundationJsonPath);
  const foundationRaw = JSON.parse(await fs.readFile(foundationJsonPath, "utf8")) as unknown;
  const foundationItems = pickItemArray(foundationRaw);
  for (const raw of foundationItems) {
    if (!isRecord(raw)) {
      stats.raw++;
      stats.skippedNoFdcId++;
      continue;
    }
    const normalized = normalizeFoundation(raw as unknown as RawFoundationItem, stats);
    if (normalized) foods.push(normalized);
  }
  const foundationCount = stats.kept;
  console.log(
    `[ingest] Foundation: ${stats.kept}/${stats.raw} items kept (entry=${foundationEntry}, ` +
      `${((Date.now() - tFoundation) / 1000).toFixed(2)}s)`,
  );

  console.log(`[ingest] extracting Survey/FNDDS from ${path.basename(surveyZip)} ...`);
  const tSurvey = Date.now();
  const surveyStartIdx = foods.length;
  const surveyStartStats = { ...stats };
  const surveyEntry = await extractZipJson(surveyZip, surveyJsonPath);
  const surveyRawJson = JSON.parse(await fs.readFile(surveyJsonPath, "utf8")) as unknown;
  const surveyItems = pickItemArray(surveyRawJson);
  for (const raw of surveyItems) {
    if (!isRecord(raw)) {
      stats.raw++;
      stats.skippedNoFdcId++;
      continue;
    }
    const normalized = normalizeSurvey(raw as unknown as RawSurveyItem, stats);
    if (normalized) foods.push(normalized);
  }
  const surveyCount = foods.length - surveyStartIdx;
  const surveyRaw = stats.raw - surveyStartStats.raw;
  console.log(
    `[ingest] Survey: ${surveyCount}/${surveyRaw} items kept (entry=${surveyEntry}, ` +
      `${((Date.now() - tSurvey) / 1000).toFixed(2)}s)`,
  );

  if (foods.length === 0) {
    throw new Error("No foods ingested - aborting before writing artifacts.");
  }

  // Stable, case-insensitive sort by name.
  foods.sort((a, b) => {
    const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (cmp !== 0) return cmp;
    return a.id - b.id;
  });

  console.log(`[write] writing ${foods.length} foods to ${path.relative(PROJECT_ROOT, FOODS_PATH)} ...`);
  const foodsBytes = await writeFoodsJson(foods);

  const version = `${FOUNDATION_DATE}+${SURVEY_DATE}`;
  const meta: DataMeta = {
    version,
    generatedAt: new Date().toISOString(),
    foundationCount,
    surveyCount,
    totalCount: foods.length,
  };
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2) + "\n");

  console.log(`[write] resolving demo plan ...`);
  const { file: demoFile, unresolved } = buildDemoPlan(foods, version);
  const demoBytes = await writeDemoPlan(demoFile);

  for (const slot of Object.keys(demoFile.meals) as MealSlot[]) {
    for (const entry of demoFile.meals[slot]) {
      console.log(
        `  [demo] ${slot.padEnd(9)} fdcId=${String(entry.fdcId).padStart(7)} ` +
          `${entry.portionDescription} (${entry.gramWeight} g) -> ${entry.name}`,
      );
    }
  }
  if (unresolved.length > 0) {
    console.warn(`  [demo] WARNING: ${unresolved.length} unresolved demo entries:`);
    for (const u of unresolved) console.warn(`         ${u.slot}: "${u.query}"`);
  }

  const totalBytes = await totalDataDirBytes();
  const totalDuration = ((Date.now() - t0) / 1000).toFixed(2);

  console.log("");
  console.log("================ build:data summary ================");
  console.log(`  version           ${meta.version}`);
  console.log(`  generatedAt       ${meta.generatedAt}`);
  console.log(`  foundationCount   ${meta.foundationCount}`);
  console.log(`  surveyCount       ${meta.surveyCount}`);
  console.log(`  totalCount        ${meta.totalCount}`);
  console.log(`  foodsBytes        ${formatBytes(foodsBytes)}`);
  console.log(`  demoPlanBytes     ${formatBytes(demoBytes)}`);
  console.log(`  publicDataBytes   ${formatBytes(totalBytes)}`);
  console.log(`  skippedNoFdcId    ${stats.skippedNoFdcId}`);
  console.log(`  skippedNoNutrient ${stats.skippedNoNutrients}`);
  console.log(`  zeroSourcePortion ${stats.withZeroPortionsSource} (fell back to synthetic 100 g only)`);
  console.log(`  outputDir         ${DATA_DIR}`);
  console.log(`  total elapsed     ${totalDuration}s`);
  console.log("====================================================");
}

main().catch((err) => {
  console.error("[build:data] failed:", err);
  process.exit(1);
});
