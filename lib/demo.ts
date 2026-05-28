/**
 * Demo plan support. The build script writes a fully-resolved demo plan to
 * `/data/demo-plan.json` (foods picked deterministically from the released
 * dataset), so all the runtime needs to do is fetch + clone for the given
 * date.
 */

import { nanoid } from "nanoid";
import type { DailyPlan, MealEntry, MealSlot } from "./types";

interface DemoPlanFile {
  version: string;
  meals: Record<MealSlot, Omit<MealEntry, "id">[]>;
}

let cachedFile: Promise<DemoPlanFile> | null = null;

async function loadDemoFile(): Promise<DemoPlanFile> {
  if (!cachedFile) {
    cachedFile = fetch("/data/demo-plan.json", { cache: "force-cache" }).then(
      async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch demo plan (status ${res.status})`);
        }
        return (await res.json()) as DemoPlanFile;
      },
    );
  }
  return cachedFile;
}

/** Builds a starter DailyPlan for the given date by cloning the static demo. */
export async function buildDemoPlan(date: string): Promise<DailyPlan> {
  const file = await loadDemoFile();
  const meals = {} as DailyPlan["meals"];
  for (const slot of Object.keys(file.meals) as MealSlot[]) {
    meals[slot] = file.meals[slot].map((e) => ({ ...e, id: nanoid() }));
  }
  return { date, meals };
}

/** localStorage key used to remember that the user dismissed the demo. */
export const DEMO_DISMISSED_KEY = "diet-rater:demo-dismissed";

export function isDemoDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEMO_DISMISSED_KEY) === "1";
}

export function dismissDemo(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_DISMISSED_KEY, "1");
}
