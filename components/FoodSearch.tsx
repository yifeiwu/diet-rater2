"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { getFood } from "@/lib/db";
import { searchFoods, type SearchResult } from "@/lib/search";
import type { Food } from "@/lib/types";

interface FoodSearchProps {
  onPick: (food: Food) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function FoodSearch(props: FoodSearchProps): JSX.Element {
  const { onPick, placeholder = "Search foods…", autoFocus } = props;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickingRef = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setOpen(false);
      setActiveIdx(0);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const r = await searchFoods(trimmed, 12);
          if (cancelled) return;
          setResults(r);
          setActiveIdx(0);
          setOpen(r.length > 0);
        } catch (e) {
          if (cancelled) return;
          console.error("FoodSearch: search failed", e);
          setResults([]);
          setOpen(false);
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    function handleDown(e: MouseEvent): void {
      const node = containerRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 2000);
    return () => clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIdx];
    if (active instanceof HTMLElement) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, open]);

  const handlePick = useCallback(
    async (result: SearchResult): Promise<void> => {
      if (pickingRef.current) return;
      pickingRef.current = true;
      try {
        const food = await getFood(result.id);
        if (!food) {
          setError("Food unavailable. Try again.");
          return;
        }
        onPick(food);
        setQuery("");
        setResults([]);
        setOpen(false);
        setActiveIdx(0);
      } catch (e) {
        console.error("FoodSearch: getFood failed", e);
        setError("Food unavailable. Try again.");
      } finally {
        pickingRef.current = false;
      }
    },
    [onPick],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!open || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = results[activeIdx];
        if (target) void handlePick(target);
      }
    },
    [activeIdx, handlePick, open, results],
  );

  const showDropdown = open && results.length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          setQuery(e.target.value)
        }
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="food-search-listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          showDropdown ? `food-search-opt-${activeIdx}` : undefined
        }
      />

      {error ? (
        <div className="mt-1 text-xs text-accent-danger" role="alert">
          {error}
        </div>
      ) : null}

      {showDropdown ? (
        <ul
          ref={listRef}
          id="food-search-listbox"
          role="listbox"
          className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto py-1"
        >
          {results.map((r, idx) => (
            <li
              key={r.id}
              id={`food-search-opt-${idx}`}
              role="option"
              aria-selected={idx === activeIdx}
              className={clsx(
                "cursor-pointer px-3 py-2",
                idx === activeIdx ? "bg-white/10" : "hover:bg-white/5",
              )}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                void handlePick(r);
              }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
                  {renderHighlighted(r.name, query)}
                </span>
                <span className="pill shrink-0">
                  {dataTypeLabel(r.dataType)}
                </span>
              </div>
              {r.category ? (
                <div className="mt-0.5 truncate text-xs text-slate-400">
                  {r.category}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function dataTypeLabel(d: SearchResult["dataType"]): string {
  return d === "Foundation" ? "Foundation" : "FNDDS";
}

function renderHighlighted(name: string, query: string): JSX.Element {
  const trimmed = query.trim();
  if (trimmed.length < 2) return <>{name}</>;
  const idx = name.toLowerCase().indexOf(trimmed.toLowerCase());
  if (idx < 0) return <>{name}</>;
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + trimmed.length);
  const after = name.slice(idx + trimmed.length);
  return (
    <>
      {before}
      <span className="text-accent">{match}</span>
      {after}
    </>
  );
}
