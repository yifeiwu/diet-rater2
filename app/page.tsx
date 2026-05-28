"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataLoader from "@/components/DataLoader";
import MealSection from "@/components/MealSection";
import NutrientPanel from "@/components/NutrientPanel";
import { getMany, getPlan, upsertPlan } from "@/lib/db";
import {
  buildDemoPlan,
  dismissDemo,
  isDemoDismissed,
} from "@/lib/demo";
import { entryTotals } from "@/lib/nutrients";
import type {
  DailyPlan,
  Food,
  MealEntry,
  MealSlot,
} from "@/lib/types";
import { MEAL_SLOTS } from "@/lib/types";

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyPlan(date: string): DailyPlan {
  return {
    date,
    meals: { breakfast: [], lunch: [], dinner: [], snacks: [] },
  };
}

function planIsEmpty(plan: DailyPlan): boolean {
  return MEAL_SLOTS.every((slot) => plan.meals[slot].length === 0);
}

export default function HomePage(): JSX.Element {
  return (
    <DataLoader>
      <Planner />
    </DataLoader>
  );
}

function Planner(): JSX.Element {
  const [date, setDate] = useState<string>(todayISO);
  const [plan, setPlan] = useState<DailyPlan>(() => emptyPlan(todayISO()));
  const [foodsById, setFoodsById] = useState<Map<number, Food>>(new Map());
  const [showDemoBanner, setShowDemoBanner] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    onUndo?: () => void;
  } | null>(null);

  const persistTimer = useRef<number | null>(null);

  // Load (or create) the plan whenever the date changes.
  useEffect(() => {
    let cancelled = false;
    setPlanLoaded(false);

    void (async () => {
      const existing = await getPlan(date);

      if (existing && !planIsEmpty(existing)) {
        if (cancelled) return;
        setPlan(existing);
        setShowDemoBanner(false);
        setPlanLoaded(true);
        return;
      }

      // No existing plan, OR existing plan is empty.
      // Seed the demo only on the first ever visit (no dismissal flag).
      const isToday = date === todayISO();
      if (isToday && !isDemoDismissed()) {
        try {
          const demo = await buildDemoPlan(date);
          if (cancelled) return;
          if (planIsEmpty(demo)) {
            setPlan(emptyPlan(date));
          } else {
            setPlan(demo);
            setShowDemoBanner(true);
          }
        } catch {
          if (cancelled) return;
          setPlan(emptyPlan(date));
        }
      } else {
        if (cancelled) return;
        setPlan(emptyPlan(date));
        setShowDemoBanner(false);
      }
      setPlanLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [date]);

  // Hydrate `foodsById` for every fdcId referenced by the current plan.
  useEffect(() => {
    if (!planLoaded) return;
    const ids = new Set<number>();
    for (const slot of MEAL_SLOTS) {
      for (const e of plan.meals[slot]) ids.add(e.fdcId);
    }
    const missing = [...ids].filter((id) => !foodsById.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      const fetched = await getMany(missing);
      if (cancelled) return;
      setFoodsById((prev) => {
        const next = new Map(prev);
        for (const f of fetched) next.set(f.id, f);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [plan, planLoaded, foodsById]);

  // Debounced persistence to IDB.
  useEffect(() => {
    if (!planLoaded) return;
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      void upsertPlan(plan);
    }, 200);
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [plan, planLoaded]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const dayKcal = useMemo(() => {
    let kcal = 0;
    for (const slot of MEAL_SLOTS) {
      for (const e of plan.meals[slot]) {
        kcal += entryTotals(e, foodsById.get(e.fdcId)).energy ?? 0;
      }
    }
    return kcal;
  }, [plan, foodsById]);

  const handleAdd = useCallback(
    (slot: MealSlot, entry: MealEntry, fetchedFood?: Food) => {
      setPlan((p) => ({
        ...p,
        meals: { ...p.meals, [slot]: [...p.meals[slot], entry] },
      }));
      if (fetchedFood) {
        setFoodsById((prev) => {
          if (prev.has(fetchedFood.id)) return prev;
          const next = new Map(prev);
          next.set(fetchedFood.id, fetchedFood);
          return next;
        });
      }
      setShowDemoBanner(false);
    },
    [],
  );

  const handleUpdate = useCallback(
    (
      slot: MealSlot,
      id: string,
      patch: Partial<
        Pick<MealEntry, "portionDescription" | "gramWeight" | "servings">
      >,
    ) => {
      setPlan((p) => ({
        ...p,
        meals: {
          ...p.meals,
          [slot]: p.meals[slot].map((e) =>
            e.id === id ? { ...e, ...patch } : e,
          ),
        },
      }));
    },
    [],
  );

  const handleRemove = useCallback((slot: MealSlot, id: string) => {
    setPlan((p) => ({
      ...p,
      meals: { ...p.meals, [slot]: p.meals[slot].filter((e) => e.id !== id) },
    }));
  }, []);

  const handleClearDay = useCallback(() => {
    if (planIsEmpty(plan)) return;
    const snapshot = plan;
    setPlan((p) => ({ ...p, meals: { breakfast: [], lunch: [], dinner: [], snacks: [] } }));
    if (showDemoBanner) {
      dismissDemo();
      setShowDemoBanner(false);
    }
    setToast({
      message: "Cleared all meals for the day.",
      onUndo: () => {
        setPlan(snapshot);
        setToast(null);
      },
    });
  }, [plan, showDemoBanner]);

  const handleDismissDemo = useCallback(() => {
    dismissDemo();
    setShowDemoBanner(false);
  }, []);

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Diet Rater</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Plan meals from USDA FoodData Central. All data lives in your
            browser.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Date
            </span>
            <input
              type="date"
              className="input w-auto"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <div className="flex flex-col items-end">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Day total
            </span>
            <span className="text-lg font-semibold text-accent">
              {Math.round(dayKcal)} kcal
            </span>
          </div>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={handleClearDay}
            disabled={planIsEmpty(plan)}
          >
            Clear day
          </button>
        </div>
      </header>

      {showDemoBanner && (
        <div className="card mb-4 px-4 py-2.5 flex items-center justify-between gap-3 bg-accent/5 ring-accent/20">
          <p className="text-xs text-slate-300">
            <span className="font-medium text-accent">Sample plan loaded.</span>{" "}
            Click <strong>Clear day</strong> to start fresh, or just edit any item below.
          </p>
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-200"
            onClick={handleDismissDemo}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,560px)] gap-6">
        <div className="space-y-3">
          {MEAL_SLOTS.map((slot) => (
            <MealSection
              key={slot}
              slot={slot}
              title={SLOT_LABELS[slot]}
              entries={plan.meals[slot]}
              foodsById={foodsById}
              onAdd={(entry, food) => handleAdd(slot, entry, food)}
              onUpdate={(id, patch) => handleUpdate(slot, id, patch)}
              onRemove={(id) => handleRemove(slot, id)}
            />
          ))}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <NutrientPanel plan={plan} foodsById={foodsById} />
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
          <div className="card px-4 py-2.5 flex items-center gap-3 ring-white/10">
            <span className="text-sm text-slate-200">{toast.message}</span>
            {toast.onUndo && (
              <button
                type="button"
                className="text-xs font-semibold text-accent hover:text-accent/80"
                onClick={toast.onUndo}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-200"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <footer className="mt-10 text-center text-[11px] text-slate-500">
        Nutrient data from{" "}
        <a
          className="hover:text-accent"
          href="https://fdc.nal.usda.gov/"
          target="_blank"
          rel="noreferrer"
        >
          USDA FoodData Central
        </a>{" "}
        (Foundation Foods + FNDDS). Daily Values from FDA 2016 reference for
        adults.
      </footer>
    </main>
  );
}
