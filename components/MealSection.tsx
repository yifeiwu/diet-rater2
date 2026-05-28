"use client";

import clsx from "clsx";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import FoodSearch from "./FoodSearch";
import { entryGrams, entryTotals, formatAmount } from "@/lib/nutrients";
import type { Food, FoodPortion, MealEntry, MealSlot } from "@/lib/types";

interface MealSectionProps {
  slot: MealSlot;
  title: string;
  entries: MealEntry[];
  /** Lookup of the foods referenced by `entries`. May be missing during loading. */
  foodsById: Map<number, Food>;
  /** Receives the new entry plus the resolved Food so the parent can prime its lookup map. */
  onAdd: (entry: MealEntry, food: Food) => void;
  onUpdate: (id: string, patch: Partial<Pick<MealEntry, "portionDescription" | "gramWeight" | "servings">>) => void;
  onRemove: (id: string) => void;
}

const CUSTOM_PORTION = "__custom__";

export default function MealSection({
  slot,
  title,
  entries,
  foodsById,
  onAdd,
  onUpdate,
  onRemove,
}: MealSectionProps): JSX.Element {
  const [searching, setSearching] = useState(false);

  const slotKcal = useMemo(() => {
    let kcal = 0;
    for (const e of entries) {
      const food = foodsById.get(e.fdcId);
      const totals = entryTotals(e, food);
      kcal += totals.energy ?? 0;
    }
    return kcal;
  }, [entries, foodsById]);

  function defaultPortion(food: Food): FoodPortion {
    return (
      food.portions.find((p) => p.description !== "100 g") ??
      food.portions[0] ?? { description: "100 g", gramWeight: 100 }
    );
  }

  function handlePick(food: Food): void {
    setSearching(false);
    const portion = defaultPortion(food);
    onAdd(
      {
        id: nanoid(),
        fdcId: food.id,
        name: food.name,
        portionDescription: portion.description,
        gramWeight: portion.gramWeight,
        servings: 1,
      },
      food,
    );
  }

  return (
    <section className="card p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-200 capitalize">
          {title}
        </h2>
        <span className="pill">{Math.round(slotKcal)} kcal</span>
      </header>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-500 italic mb-3">No items yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              food={foodsById.get(entry.fdcId)}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

      {searching ? (
        <div className="space-y-2">
          <FoodSearch
            onPick={handlePick}
            placeholder={`Add to ${title.toLowerCase()}…`}
            autoFocus
          />
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setSearching(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-ghost text-xs w-full justify-start text-slate-400 hover:text-accent border border-dashed border-white/10 hover:border-accent/40"
          onClick={() => setSearching(true)}
        >
          + Add food
        </button>
      )}
    </section>
  );
}

interface EntryRowProps {
  entry: MealEntry;
  food: Food | undefined;
  onUpdate: MealSectionProps["onUpdate"];
  onRemove: MealSectionProps["onRemove"];
}

function EntryRow({ entry, food, onUpdate, onRemove }: EntryRowProps): JSX.Element {
  const [servingsText, setServingsText] = useState(entry.servings.toString());
  const [customGrams, setCustomGrams] = useState(
    !food || food.portions.some((p) => p.description === entry.portionDescription)
      ? null
      : entry.gramWeight,
  );

  const portions = useMemo(() => {
    if (!food) return [];
    const list = [...food.portions];
    if (!list.some((p) => p.description === entry.portionDescription) && customGrams === null) {
      list.unshift({
        description: entry.portionDescription,
        gramWeight: entry.gramWeight,
      });
    }
    return list;
  }, [food, entry.portionDescription, entry.gramWeight, customGrams]);

  const totalGrams = entryGrams(entry);
  const kcal = food ? (entryTotals(entry, food).energy ?? 0) : 0;

  function handlePortionChange(value: string): void {
    if (value === CUSTOM_PORTION) {
      const initial = entry.gramWeight;
      setCustomGrams(initial);
      onUpdate(entry.id, {
        portionDescription: `${initial} g`,
        gramWeight: initial,
      });
      return;
    }
    setCustomGrams(null);
    const portion = food?.portions.find((p) => p.description === value);
    if (!portion) return;
    onUpdate(entry.id, {
      portionDescription: portion.description,
      gramWeight: portion.gramWeight,
    });
  }

  function handleCustomGramsChange(value: string): void {
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setCustomGrams(num);
    onUpdate(entry.id, {
      portionDescription: `${num} g`,
      gramWeight: num,
    });
  }

  function handleServingsBlur(): void {
    const num = parseFloat(servingsText);
    if (!Number.isFinite(num) || num <= 0) {
      setServingsText(entry.servings.toString());
      return;
    }
    if (num !== entry.servings) {
      onUpdate(entry.id, { servings: num });
    }
  }

  return (
    <li className="rounded-lg bg-bg-soft/60 ring-1 ring-white/5 p-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-100 truncate" title={entry.name}>
            {entry.name}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <select
              className="input py-1 px-2 text-xs w-auto max-w-[170px]"
              value={customGrams !== null ? CUSTOM_PORTION : entry.portionDescription}
              onChange={(e) => handlePortionChange(e.target.value)}
              disabled={!food}
              aria-label="Portion"
            >
              {portions.map((p) => (
                <option key={p.description} value={p.description}>
                  {p.description} ({formatAmount(p.gramWeight, "g")} g)
                </option>
              ))}
              <option value={CUSTOM_PORTION}>Custom (g)…</option>
            </select>

            {customGrams !== null && (
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                className="input py-1 px-2 text-xs w-20"
                value={customGrams}
                onChange={(e) => handleCustomGramsChange(e.target.value)}
                aria-label="Grams"
              />
            )}

            <span className="text-slate-500">×</span>

            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              className="input py-1 px-2 text-xs w-16"
              value={servingsText}
              onChange={(e) => setServingsText(e.target.value)}
              onBlur={handleServingsBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Servings"
            />

            <span className="text-slate-500">servings</span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400">
            <span>
              Total: <strong className="text-slate-200">{formatAmount(totalGrams, "g")} g</strong>
            </span>
            <span className="mx-1.5">·</span>
            <span>
              <strong className="text-slate-200">{Math.round(kcal)}</strong> kcal
            </span>
            {!food && (
              <span className="ml-2 text-accent-warm">loading…</span>
            )}
          </div>
        </div>

        <button
          type="button"
          className={clsx(
            "shrink-0 rounded-md p-1.5 text-slate-500 hover:text-accent-danger hover:bg-white/5 transition-colors",
            "focus:outline-none focus:ring-1 focus:ring-accent-danger/60",
          )}
          onClick={() => onRemove(entry.id)}
          aria-label={`Remove ${entry.name}`}
          title="Remove"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </li>
  );
}
