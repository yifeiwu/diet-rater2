/**
 * IndexedDB schema + singleton accessor for diet-rater.
 *
 * Owns three object stores:
 *   - foods       : keyed by FDC id; mirrors the runtime `Food` shape with a
 *                   denormalised `nameLower` field for the `by-name` index.
 *   - mealPlans   : keyed by YYYY-MM-DD; one row per day's plan.
 *   - meta        : single-row store ({"key":"fdc"}) tracking which dataset
 *                   version was last loaded so seeding can be skipped.
 *
 * Nothing in this file touches `indexedDB` at module load — every entry point
 * guards via `typeof indexedDB === "undefined"` so it is safe to import on the
 * server (Next.js will tree-shake unused branches).
 */

import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type {
  DailyPlan,
  Food,
  FoodDataType,
  IdbMetaRow,
} from "./types";

/**
 * Internal shape persisted in the `foods` object store.
 *
 * Adds a lowercased copy of `name` so we can index/search by name without
 * having to walk every record. Not exported — callers should construct these
 * structurally (i.e. `{ ...food, nameLower: food.name.toLowerCase() }`).
 */
interface IndexedFood extends Food {
  nameLower: string;
}

/** Strongly-typed `idb` schema. */
export interface DietRaterDB extends DBSchema {
  foods: {
    key: number;
    value: IndexedFood;
    indexes: {
      "by-name": string;
      "by-dataType": FoodDataType;
    };
  };
  mealPlans: {
    key: string;
    value: DailyPlan;
  };
  meta: {
    key: string;
    value: IdbMetaRow;
  };
}

const DB_NAME = "diet-rater";
const DB_VERSION = 1;

/** Module-level cache so the database is opened at most once per page. */
let dbPromise: Promise<IDBPDatabase<DietRaterDB>> | null = null;

/** Opens (or returns the cached handle to) the diet-rater IndexedDB. */
export async function getDb(): Promise<IDBPDatabase<DietRaterDB>> {
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "getDb() was called in an environment without IndexedDB (likely during SSR). " +
        "Call client-side only.",
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<DietRaterDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("foods")) {
          const foods = db.createObjectStore("foods", { keyPath: "id" });
          foods.createIndex("by-name", "nameLower");
          foods.createIndex("by-dataType", "dataType");
        }
        if (!db.objectStoreNames.contains("mealPlans")) {
          db.createObjectStore("mealPlans", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/** Drops every row in the `foods` store in a single transaction. */
export async function clearAllFoods(
  db: IDBPDatabase<DietRaterDB>,
): Promise<void> {
  const tx = db.transaction("foods", "readwrite");
  await tx.objectStore("foods").clear();
  await tx.done;
}

/**
 * Inserts (or replaces) many foods in a single readwrite transaction.
 *
 * Callers should pre-attach `nameLower` to each food. Puts are issued without
 * `await` so they pipeline; we only await the transaction's `done` promise.
 */
export async function bulkPutFoods(
  db: IDBPDatabase<DietRaterDB>,
  foods: IndexedFood[],
): Promise<void> {
  if (foods.length === 0) return;
  const tx = db.transaction("foods", "readwrite");
  const store = tx.objectStore("foods");
  for (const food of foods) {
    void store.put(food);
  }
  await tx.done;
}

/** Removes the synthetic `nameLower` field on the way back out to callers. */
function toFood(stored: IndexedFood | undefined): Food | undefined {
  if (!stored) return undefined;
  const { nameLower: _nameLower, ...food } = stored;
  return food;
}

/** Looks up one food by FDC id; strips internal indexing fields. */
export async function getFood(id: number): Promise<Food | undefined> {
  const db = await getDb();
  const stored = await db.get("foods", id);
  return toFood(stored);
}

/** Returns every food in the store. Used by `seed.ts` to rebuild the search index. */
export async function getAllFoods(): Promise<Food[]> {
  const db = await getDb();
  const stored = await db.getAll("foods");
  const out: Food[] = [];
  for (const row of stored) {
    const food = toFood(row);
    if (food) out.push(food);
  }
  return out;
}

/** Looks up many foods by FDC id in parallel within one transaction. */
export async function getMany(ids: number[]): Promise<Food[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const tx = db.transaction("foods", "readonly");
  const store = tx.objectStore("foods");
  const stored = await Promise.all(ids.map((id) => store.get(id)));
  await tx.done;
  const out: Food[] = [];
  for (const row of stored) {
    const food = toFood(row);
    if (food) out.push(food);
  }
  return out;
}

/** Reads a day's meal plan (YYYY-MM-DD key). */
export async function getPlan(date: string): Promise<DailyPlan | undefined> {
  const db = await getDb();
  return db.get("mealPlans", date);
}

/** Inserts or replaces a day's meal plan. */
export async function upsertPlan(plan: DailyPlan): Promise<void> {
  const db = await getDb();
  await db.put("mealPlans", plan);
}

/** Deletes a day's meal plan. */
export async function deletePlan(date: string): Promise<void> {
  const db = await getDb();
  await db.delete("mealPlans", date);
}
