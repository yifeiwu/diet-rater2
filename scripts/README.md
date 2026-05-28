# scripts/

Build-time tooling for the static USDA FoodData Central dataset that ships
inside `public/data/`. None of this code runs in the browser; it executes
once per dataset bump via `npm run build:data`.

## What lives here

- **`extract-fdc-data.ts`** — entry point invoked by `npm run build:data`.
  Coordinates the full pipeline: download, stream-parse, normalize, sort,
  shard, build the MiniSearch index, and write `meta.json`.
- **`fetch-fdc.ts`** — low-level helpers for HTTPS downloads (with redirect
  following + retries) and stream-extracting the first `.json` entry inside
  a USDA ZIP. Uses `yauzl` for the ZIP layer and `stream-json` for the JSON
  layer so the >100 MB FNDDS JSON never lands in memory as a single value.
- **`.cache/`** — gitignored cache of downloaded `*.zip` files. Safe to nuke
  at any time; the next `build:data` will re-download.

## Where the input comes from

| Dataset           | URL date stamp | Approx unzipped size |
|-------------------|----------------|----------------------|
| Foundation Foods  | `2026-04-30`   | ~6.7 MB              |
| Survey (FNDDS)    | `2024-10-31`   | ~66 MB               |

Both files come from <https://fdc.nal.usda.gov/fdc-datasets/>.

## What gets written

Everything under `/public/data/` is regenerated from scratch on every run.
Stale shards (matching `\d{3,}\.json`) are deleted before new ones are
written.

- `public/data/meta.json` — matches `DataMeta` in `lib/types.ts`. `version`
  is `${foundationDate}+${surveyDate}` so any client cache can do
  `cachedVersion !== meta.version` to know whether to re-hydrate IDB.
- `public/data/foods/NNN.json` — sorted shards of `Food[]`, target ~5 MB or
  1500 items per shard (whichever fills up first). Sort key is
  `name.toLowerCase()` so diffs across dataset bumps are minimal.
- `public/data/foods.index.json` — `JSON.stringify(MiniSearch.toJSON())`.
  The client re-hydrates with `MiniSearch.loadJSON()` and supplies its own
  `searchOptions` (we recommend `{ prefix: true, fuzzy: 0.2 }`).

## Nutrient + portion normalization rules

These are intentionally lossy and the implementation lives in
`extract-fdc-data.ts`:

- Nutrient ids are filtered through `fdcIdToKey()` from
  `lib/nutrient-defs.ts`. Anything not in the Phase-0.5 keep-list is
  dropped. A food with zero keepable nutrients is skipped (the counter
  prints at the end of the run).
- Each `Food.portions` array always starts with a synthetic `100 g`
  portion. Source portions with non-positive `gramWeight` are skipped.
  Description preference order: `portionDescription` → `${amount} modifier`
  → `${amount} measureUnit.name|abbreviation` → `"1 portion"`. Exact
  `(description, gramWeight)` pairs are de-duplicated.
- Null entries inside the USDA top-level array (the Foundation dataset
  ships ~32 of them) are silently skipped and counted under
  `skippedNoFdcId`.

## Re-running

```
cd /path/to/diet-rater
npm run build:data        # uses cached ZIPs if present
rm -rf scripts/.cache     # force a fresh download
```

If USDA bumps the dataset stamps, edit `FOUNDATION_DATE` / `SURVEY_DATE` at
the top of `extract-fdc-data.ts`. The `version` field in `meta.json` will
change, which is the signal the runtime uses to invalidate IndexedDB.
