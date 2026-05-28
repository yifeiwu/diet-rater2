"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureSeeded, type SeedProgress } from "@/lib/seed";

interface DataLoaderProps {
  children: React.ReactNode;
}

declare global {
  interface Window {
    __dietRaterReady?: boolean;
  }
}

const INITIAL_PROGRESS: SeedProgress = {
  phase: "checking",
  loaded: 0,
  total: 0,
};

export default function DataLoader(props: DataLoaderProps): JSX.Element {
  const [progress, setProgress] = useState<SeedProgress>(INITIAL_PROGRESS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function run(): Promise<void> {
      try {
        await ensureSeeded((p) => {
          if (!cancelledRef.current) setProgress(p);
        });
        if (cancelledRef.current) return;

        if (typeof window !== "undefined") {
          window.__dietRaterReady = true;
        }

        timeoutId = setTimeout(() => {
          if (!cancelledRef.current) setReady(true);
        }, 250);
      } catch (e) {
        if (cancelledRef.current) return;
        console.error("DataLoader: seeding failed", e);
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    }

    void run();

    return () => {
      cancelledRef.current = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setProgress(INITIAL_PROGRESS);
    setAttempt((a) => a + 1);
  }, []);

  if (ready) {
    return <>{props.children}</>;
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card w-full max-w-md p-5 ring-1 ring-accent-danger/40">
          <h2 className="text-base font-semibold text-accent-danger">
            Failed to load data
          </h2>
          <p className="mt-2 break-words text-sm text-slate-400">
            {error.message}
          </p>
          <button
            type="button"
            className="btn-primary mt-4"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : 0;
  const indeterminate = progress.total === 0 && progress.phase !== "done";

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card w-full max-w-md p-5">
        <h2 className="text-base font-semibold text-slate-100">
          Loading USDA FoodData Central…
        </h2>

        <div
          className="mt-4 h-2 w-full overflow-hidden rounded bg-bg-soft"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : pct}
        >
          {indeterminate ? (
            <div className="h-2 w-1/3 animate-pulse rounded bg-accent/60" />
          ) : (
            <div
              className="h-2 rounded bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>

        <div className="mt-3 flex justify-between text-xs text-slate-400">
          <span>{phaseLabel(progress.phase)}</span>
          <span>
            {progress.total > 0
              ? `${progress.loaded.toLocaleString()} / ${progress.total.toLocaleString()}`
              : "preparing…"}
          </span>
        </div>

        {progress.message ? (
          <p className="mt-1 truncate text-xs text-slate-500">
            {progress.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function phaseLabel(p: SeedProgress["phase"]): string {
  switch (p) {
    case "checking":
      return "Checking local cache";
    case "downloading":
      return "Downloading foods";
    case "writing-foods":
      return "Saving to local DB";
    case "indexing":
      return "Building search index";
    case "done":
      return "Ready";
  }
}
