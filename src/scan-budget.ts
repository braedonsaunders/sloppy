/**
 * Adaptive API budget tracking for GitHub Models free tier.
 *
 * Rate limits are per-model, so using multiple models multiplies capacity:
 *   - High-tier (GPT-4o, GPT-4o-mini): 50 requests/day, 10/min
 *   - Low-tier (Mistral, Llama): 150 requests/day, 15/min
 *
 * This module tracks usage across models and routes requests to
 * models with remaining budget, maximizing total daily capacity.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';

// ---------------------------------------------------------------------------
// Model tier definitions
// ---------------------------------------------------------------------------

export interface ModelTier {
  requestsPerDay: number;
  requestsPerMinute: number;
  inputTokens: number;
  outputTokens: number;
  concurrent: number;
  tier: 'high' | 'low';
}

const MODEL_TIERS: Record<string, ModelTier> = {
  'openai/gpt-4o': {
    requestsPerDay: 50, requestsPerMinute: 10,
    inputTokens: 8000, outputTokens: 4000, concurrent: 2, tier: 'high',
  },
  'openai/gpt-4o-mini': {
    requestsPerDay: 50, requestsPerMinute: 10,
    inputTokens: 8000, outputTokens: 4000, concurrent: 2, tier: 'high',
  },
  'mistral-ai/mistral-small': {
    requestsPerDay: 150, requestsPerMinute: 15,
    inputTokens: 8000, outputTokens: 4000, concurrent: 5, tier: 'low',
  },
  'meta-llama/Meta-Llama-3.1-70B-Instruct': {
    requestsPerDay: 150, requestsPerMinute: 15,
    inputTokens: 8000, outputTokens: 4000, concurrent: 5, tier: 'low',
  },
  'meta-llama/Meta-Llama-3.1-8B-Instruct': {
    requestsPerDay: 150, requestsPerMinute: 15,
    inputTokens: 8000, outputTokens: 4000, concurrent: 5, tier: 'low',
  },
};

export function getModelTier(model: string): ModelTier {
  return MODEL_TIERS[model] || {
    requestsPerDay: 50, requestsPerMinute: 10,
    inputTokens: 8000, outputTokens: 4000, concurrent: 2, tier: 'high',
  };
}

// ---------------------------------------------------------------------------
// Budget state
// ---------------------------------------------------------------------------

interface BudgetEntry {
  model: string;
  date: string; // YYYY-MM-DD
  requestsUsed: number;
  lastRequestAt: number; // epoch ms
}

interface BudgetData {
  entries: BudgetEntry[];
}

const BUDGET_FILE = '.sloppy/budget.json';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadBudget(cwd: string): BudgetData {
  try {
    const p = path.join(cwd, BUDGET_FILE);
    if (!fs.existsSync(p)) return { entries: [] };
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    // Prune old entries (only keep today)
    data.entries = (data.entries || []).filter((e: BudgetEntry) => e.date === today());
    return data;
  } catch {
    return { entries: [] };
  }
}

function saveBudget(cwd: string, budget: BudgetData): void {
  try {
    const dir = path.join(cwd, '.sloppy');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(cwd, BUDGET_FILE), JSON.stringify(budget, null, 2));
  } catch {
    // Non-fatal
  }
}

function getEntry(budget: BudgetData, model: string): BudgetEntry {
  let entry = budget.entries.find(e => e.model === model && e.date === today());
  if (!entry) {
    entry = { model, date: today(), requestsUsed: 0, lastRequestAt: 0 };
    budget.entries.push(entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class ScanBudget {
  private budget: BudgetData;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.budget = loadBudget(cwd);
  }

  /** Record that a request was made to a model. */
  recordRequest(model: string): void {
    const entry = getEntry(this.budget, model);
    entry.requestsUsed++;
    entry.lastRequestAt = Date.now();
    saveBudget(this.cwd, this.budget);
  }

  /** Get remaining requests for a model today. */
  remaining(model: string): number {
    const tier = getModelTier(model);
    const entry = getEntry(this.budget, model);
    return Math.max(0, tier.requestsPerDay - entry.requestsUsed);
  }

  /** Get total remaining requests across all known models. */
  totalRemaining(): number {
    let total = 0;
    for (const model of Object.keys(MODEL_TIERS)) {
      total += this.remaining(model);
    }
    return total;
  }

  /** Get the number of requests used for a model today. */
  used(model: string): number {
    return getEntry(this.budget, model).requestsUsed;
  }

  /**
   * Select the best model for a given scan type.
   * For fingerprint scans: prefer low-tier models (more daily budget).
   * For deep scans: prefer the user-configured model (typically higher quality).
   *
   * Falls back to the primary model if all secondary models are exhausted.
   */
  selectModel(primaryModel: string, scanType: 'fingerprint' | 'deep'): string {
    // For deep scans, always use the primary model if budget allows
    if (scanType === 'deep') {
      if (this.remaining(primaryModel) > 0) return primaryModel;
      // Try low-tier fallbacks
      return this.findAvailableModel('low') || primaryModel;
    }

    // For fingerprint scans, prefer low-tier models to conserve primary budget
    const lowTier = this.findAvailableModel('low');
    if (lowTier) return lowTier;

    // Fall back to primary
    if (this.remaining(primaryModel) > 0) return primaryModel;

    // Try any available model
    return this.findAvailableModel() || primaryModel;
  }

  /** Find a model with remaining budget, optionally filtered by tier. */
  private findAvailableModel(tier?: 'high' | 'low'): string | null {
    const candidates = Object.entries(MODEL_TIERS)
      .filter(([, t]) => !tier || t.tier === tier)
      .filter(([m]) => this.remaining(m) > 0)
      .sort((a, b) => this.remaining(b[0]) - this.remaining(a[0]));

    return candidates.length > 0 ? candidates[0][0] : null;
  }

  /**
   * Determine the scan aggressiveness based on remaining budget.
   * - flush: 40+ calls remaining → deep scan + fingerprint
   * - normal: 15-40 calls remaining → fingerprint-only, rely on Layer 0
   * - critical: <15 calls remaining → Layer 0 only, skip AI
   */
  getScanLevel(primaryModel: string): 'flush' | 'normal' | 'critical' {
    const primaryRemaining = this.remaining(primaryModel);
    const totalRemaining = this.totalRemaining();

    if (totalRemaining < 15) return 'critical';
    if (primaryRemaining >= 20 || totalRemaining >= 40) return 'flush';
    return 'normal';
  }

  /** Log budget status. */
  logStatus(primaryModel: string): void {
    const level = this.getScanLevel(primaryModel);
    const primaryRemaining = this.remaining(primaryModel);
    const totalRemaining = this.totalRemaining();

    const levelLabel = level === 'flush' ? 'flush' : level === 'normal' ? 'normal' : 'CRITICAL';
    core.info(`  Budget: ${primaryRemaining} primary (${primaryModel}), ${totalRemaining} total across all models [${levelLabel}]`);
  }
}
