/**
 * Scan result cache — skip unchanged files on repeat scans.
 *
 * Stores issues keyed by file content hash. On subsequent runs, files whose
 * hash matches the cache are skipped entirely (zero API calls). For a 77-file
 * repo where 5 files changed, this means 72 files are free.
 *
 * Cache is stored in .sloppy/scan-cache.json within the workspace.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Issue } from './types';

const CACHE_DIR = '.sloppy';
const CACHE_FILE = 'scan-cache.json';
const CACHE_VERSION = 2;

export type ScanStrategy = 'deep' | 'fingerprint';

interface CacheEntry {
  hash: string;
  issues: Issue[];
  strategy: ScanStrategy;
  scannedAt: string;
}

interface CacheData {
  version: number;
  model: string;
  entries: Record<string, CacheEntry>;
}

function getCachePath(cwd: string): string {
  return path.join(cwd, CACHE_DIR, CACHE_FILE);
}

function hashFileContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Load the scan cache. Returns null if no cache exists or it's incompatible.
 */
export function loadCache(cwd: string, model: string): CacheData | null {
  try {
    const cachePath = getCachePath(cwd);
    if (!fs.existsSync(cachePath)) return null;

    const raw = fs.readFileSync(cachePath, 'utf-8');
    const data: CacheData = JSON.parse(raw);

    // Invalidate if version or model changed
    if (data.version !== CACHE_VERSION || data.model !== model) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Save the scan cache.
 */
export function saveCache(cwd: string, cache: CacheData): void {
  try {
    const dir = path.join(cwd, CACHE_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getCachePath(cwd), JSON.stringify(cache, null, 2));
  } catch {
    // Non-fatal — cache is a performance optimization, not a requirement.
  }
}

/**
 * Partition files into cached (skip) and uncached (need scanning).
 *
 * Returns:
 *  - cachedIssues: issues from cache for unchanged files
 *  - uncachedFiles: file paths that need scanning
 *  - cache: the cache object to update after scanning
 */
export function partitionByCache(
  filePaths: string[],
  cwd: string,
  model: string,
  strategy: ScanStrategy,
): {
  cachedIssues: Issue[];
  uncachedFiles: string[];
  cacheHits: number;
  cache: CacheData;
} {
  const existing = loadCache(cwd, model);
  const cache: CacheData = existing || {
    version: CACHE_VERSION,
    model,
    entries: {},
  };

  const cachedIssues: Issue[] = [];
  const uncachedFiles: string[] = [];
  let cacheHits = 0;

  for (const fp of filePaths) {
    const relativePath = path.relative(cwd, fp);
    let content: string;
    try {
      content = fs.readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }

    const hash = hashFileContent(content);
    const entry = cache.entries[relativePath];

    if (entry && entry.hash === hash && isStrategyCompatible(entry.strategy, strategy)) {
      // Cache hit — reuse previous results
      cachedIssues.push(...entry.issues);
      cacheHits++;
    } else {
      uncachedFiles.push(fp);
    }
  }

  return { cachedIssues, uncachedFiles, cacheHits, cache };
}

/**
 * A deep-scan cache entry satisfies any request (it's the most thorough).
 * A fingerprint-scan entry only satisfies fingerprint requests — a deep
 * scan must re-analyze the file for full accuracy.
 */
function isStrategyCompatible(cached: ScanStrategy | undefined, requested: ScanStrategy): boolean {
  if (!cached) return false;
  if (cached === 'deep') return true;
  return cached === requested;
}

/**
 * Update cache entries for files that were just scanned.
 * Call this after scanning to persist results for next run.
 */
export function updateCacheEntries(
  cache: CacheData,
  issues: Issue[],
  filePaths: string[],
  cwd: string,
  strategy: ScanStrategy,
): void {
  // Group issues by file
  const issuesByFile = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!issuesByFile.has(issue.file)) issuesByFile.set(issue.file, []);
    issuesByFile.get(issue.file)!.push(issue);
  }

  // Update cache for scanned files
  for (const fp of filePaths) {
    const relativePath = path.relative(cwd, fp);
    let content: string;
    try {
      content = fs.readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }

    cache.entries[relativePath] = {
      hash: hashFileContent(content),
      issues: issuesByFile.get(relativePath) || [],
      strategy,
      scannedAt: new Date().toISOString(),
    };
  }

  // Prune entries for files that no longer exist
  for (const key of Object.keys(cache.entries)) {
    if (!fs.existsSync(path.join(cwd, key))) {
      delete cache.entries[key];
    }
  }
}
