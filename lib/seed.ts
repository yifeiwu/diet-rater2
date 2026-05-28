/**
 * One-shot seed: fetch the static FDC dataset (a single foods.json) and bulk-
 * insert it into IndexedDB. After foods are persisted, build the in-memory
 * MiniSearch index for autocomplete.
 *
 * Idempotent: if the IDB `meta.fdc` row's version matches `/data/meta.json`,
 * the foods are read straight from IDB without re-downloading.
 */

import { bulkPutFoods, clearAllFoods, getDb, getAllFoods } from "./db";
import { buildSearchIndex } from "./search";
import type { DataMeta, Food, IdbMetaRow } from "./types";

/** Coarse progress reporting for the seeding UI. */
export type SeedProgress = {
  phase: "checking" | "downloading" | "writing-foods" | "indexing" | "done";
  loaded: number;
  total: number;
  message?: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (status ${res.status})`);
  }
  return (await res.json()) as T;
}

export async function ensureSeeded(
  onProgress?: (p: SeedProgress) => void,
): Promise<{ version: string; total: number; reused: boolean }> {
  const db = await getDb();

  onProgress?.({ phase: "checking", loaded: 0, total: 0 });
  const existing = await db.get("meta", "fdc");
  const meta = await fetchJson<DataMeta>("/data/meta.json");

  let foods: Food[];
  let reused: boolean;

  if (existing && existing.version === meta.version) {
    foods = await getAllFoods();
    reused = true;
  } else {
    onProgress?.({
      phase: "downloading",
      loaded: 0,
      total: meta.totalCount,
      message: "foods.json",
    });
    foods = await fetchJson<Food[]>("/data/foods.json");

    onProgress?.({
      phase: "writing-foods",
      loaded: 0,
      total: foods.length,
      message: "IndexedDB",
    });
    await clearAllFoods(db);
    await bulkPutFoods(
      db,
      foods.map((f) => ({ ...f, nameLower: f.name.toLowerCase() })),
    );

    const row: IdbMetaRow = {
      key: "fdc",
      version: meta.version,
      loadedAt: new Date().toISOString(),
    };
    await db.put("meta", row);
    reused = false;
  }

  onProgress?.({
    phase: "indexing",
    loaded: foods.length,
    total: foods.length,
    message: "search index",
  });
  buildSearchIndex(foods);

  onProgress?.({ phase: "done", loaded: foods.length, total: foods.length });
  return { reused, version: meta.version, total: foods.length };
}
