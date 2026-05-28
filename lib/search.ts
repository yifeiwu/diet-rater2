/**
 * MiniSearch wrapper for autocomplete.
 *
 * The index lives entirely in memory and is built on the client at app boot
 * time from whatever foods are in IndexedDB. This keeps the wire format simple
 * (one JSON array of `Food`) and lets us add user-created custom foods to the
 * same index without round-tripping through a serialized index file.
 */

import MiniSearch from "minisearch";
import type { Options } from "minisearch";
import type { Food, FoodDataType } from "./types";

/** Public shape returned by `searchFoods`. */
export interface SearchResult {
  id: number;
  name: string;
  dataType: FoodDataType;
  category?: string;
  score: number;
}

const INDEX_OPTIONS: Options = {
  fields: ["name", "category"],
  storeFields: ["id", "name", "dataType", "category"],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    boost: { name: 2 },
  },
};

const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: 0.2,
  boost: { name: 2 },
} as const;

let index: MiniSearch | null = null;

/**
 * Builds (or rebuilds) the in-memory search index from the given foods. Cheap
 * enough to call on every app boot — adding ~6k foods takes <500 ms.
 *
 * Calling again replaces the existing index (used when the dataset version
 * bumps and `seed.ts` re-populates IDB).
 */
export function buildSearchIndex(foods: readonly Food[]): void {
  const ms = new MiniSearch(INDEX_OPTIONS);
  ms.addAll(
    foods.map((f) => ({
      id: f.id,
      name: f.name,
      dataType: f.dataType,
      category: f.category,
    })),
  );
  index = ms;
}

/** Adds a single food to the existing index. No-op if the index isn't built yet. */
export function addToSearchIndex(food: Food): void {
  if (!index) return;
  index.add({
    id: food.id,
    name: food.name,
    dataType: food.dataType,
    category: food.category,
  });
}

/** Removes a food from the existing index. No-op if the index isn't built yet. */
export function removeFromSearchIndex(id: number): void {
  if (!index) return;
  index.discard(id);
}

/**
 * Runs a search against the loaded index. Returns `[]` for empty queries and
 * throws if `buildSearchIndex` hasn't been called yet.
 */
export function searchFoods(q: string, limit = 12): SearchResult[] {
  const query = q.trim();
  if (query.length === 0) return [];
  if (!index) {
    throw new Error(
      "searchFoods() called before buildSearchIndex(). Call ensureSeeded() first.",
    );
  }
  const raw = index.search(query, SEARCH_OPTIONS);
  const out: SearchResult[] = [];
  for (let i = 0; i < raw.length && out.length < limit; i++) {
    const r = raw[i];
    if (typeof r.id !== "number" || typeof r.name !== "string") continue;
    out.push({
      id: r.id,
      name: r.name,
      dataType: r.dataType as FoodDataType,
      category: typeof r.category === "string" ? r.category : undefined,
      score: r.score,
    });
  }
  return out;
}

/** Returns true once the index has been built. */
export function isSearchReady(): boolean {
  return index !== null;
}
