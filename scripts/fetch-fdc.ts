/**
 * Download + unzip helpers for the USDA FoodData Central pipeline.
 *
 * - `downloadIfMissing`  : caches HTTPS downloads to scripts/.cache/.
 * - `extractZipJson`     : extracts the first .json entry from a ZIP to disk
 *                          and returns the path. Callers do their own
 *                          JSON.parse — the FNDDS file is ~150 MB which fits
 *                          comfortably in Node's default 4 GB heap.
 */

import { promises as fs, createWriteStream } from "fs";
import https from "https";
import path from "path";
import { URL } from "url";
import yauzl from "yauzl";

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_ATTEMPTS = 3;

function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (target: string, depth: number): void => {
      if (depth > MAX_REDIRECTS) {
        return reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      }
      const req = https.get(target, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          return follow(next, depth + 1);
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${status} for ${target}`));
        }
        const tmp = `${dest}.tmp`;
        const out = createWriteStream(tmp);
        res.pipe(out);
        out.once("finish", () => {
          out.close((closeErr) => {
            if (closeErr) return reject(closeErr);
            fs.rename(tmp, dest).then(resolve, reject);
          });
        });
        out.once("error", (err) => {
          out.close(() => fs.unlink(tmp).catch(() => undefined).finally(() => reject(err)));
        });
        res.once("error", reject);
      });
      req.once("error", reject);
    };
    follow(url, 0);
  });
}

export async function downloadIfMissing(url: string, dest: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(dest);
    if (stat.isFile() && stat.size > 0) {
      console.log(`[fetch] cached ${label}: ${path.basename(dest)} (${formatBytes(stat.size)})`);
      return;
    }
  } catch {
    // not cached
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      console.log(`[fetch] downloading ${label} (attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}): ${url}`);
      await httpsDownload(url, dest);
      const stat = await fs.stat(dest);
      console.log(
        `[fetch] saved ${label}: ${path.basename(dest)} (${formatBytes(stat.size)}, ${(Date.now() - started) / 1000}s)`,
      );
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[fetch] ${label} attempt ${attempt} failed: ${(err as Error).message}`);
    }
  }
  throw new Error(`Failed to download ${label} from ${url}: ${(lastErr as Error)?.message ?? lastErr}`);
}

/**
 * Extracts the first `.json` entry from `zipPath` to `destPath`. Returns the
 * entry name found inside the archive. Skips work if `destPath` already exists
 * with non-zero size and the zip's mtime is older.
 */
export function extractZipJson(zipPath: string, destPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        return reject(err ?? new Error(`yauzl.open returned no zipfile for ${zipPath}`));
      }
      let started = false;
      let settled = false;
      const safeReject = (e: Error): void => {
        if (settled) return;
        settled = true;
        try {
          zipfile.close();
        } catch {
          // ignore
        }
        reject(e);
      };

      zipfile.on("error", safeReject);
      zipfile.on("end", () => {
        if (!started && !settled) {
          settled = true;
          reject(new Error(`No .json entry found inside ${path.basename(zipPath)}`));
        }
      });

      zipfile.on("entry", (entry) => {
        if (started) return;
        if (/\/$/.test(entry.fileName) || !entry.fileName.toLowerCase().endsWith(".json")) {
          return zipfile.readEntry();
        }
        started = true;
        const entryName = entry.fileName;

        zipfile.openReadStream(entry, (err2, readStream) => {
          if (err2 || !readStream) {
            return safeReject(err2 ?? new Error(`openReadStream failed for ${entryName}`));
          }
          const tmp = `${destPath}.tmp`;
          fs.mkdir(path.dirname(destPath), { recursive: true })
            .then(() => {
              const out = createWriteStream(tmp);
              readStream.pipe(out);
              out.once("finish", () => {
                out.close((closeErr) => {
                  if (closeErr) return safeReject(closeErr);
                  fs.rename(tmp, destPath)
                    .then(() => {
                      if (settled) return;
                      settled = true;
                      try {
                        zipfile.close();
                      } catch {
                        // ignore
                      }
                      resolve(entryName);
                    })
                    .catch(safeReject);
                });
              });
              out.once("error", (e) => {
                out.close(() =>
                  fs.unlink(tmp).catch(() => undefined).finally(() => safeReject(e)),
                );
              });
              readStream.once("error", safeReject);
            })
            .catch(safeReject);
        });
      });

      zipfile.readEntry();
    });
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value.toFixed(2)} ${units[unitIdx]}`;
}
