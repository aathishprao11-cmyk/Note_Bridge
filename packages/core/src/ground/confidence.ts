import type { ConfidenceSignals } from '../types';

/**
 * Computed confidence (BRIEF 9.3): a weighted blend of signals, then hard caps. The LLM's own
 * number is only a 5% input. Weights are starting values; they belong in config and get tuned
 * with the eval harness.
 */
export const DEFAULT_CONFIDENCE_WEIGHTS = {
  retrieval: 0.3,
  quote: 0.25,
  judgeAgreement: 0.2,
  top1Gap: 0.1,
  extractionQuality: 0.1,
  llmSelfReport: 0.05,
} as const;

export const CAPS = {
  /** Quote not verified (BRIEF 9.3). */
  quoteNotVerified: 0.4,
  /** The two judge runs disagreed (BRIEF 9.3). */
  judgeDisagreement: 0.5,
  /** Low-quality source page (BRIEF 9.3). */
  lowQualitySource: 0.5,
  /** No model judge ran: the edge comes from lexical matching only. */
  lexicalOnly: 0.6,
} as const;

export const LOW_QUALITY_BELOW = 0.6;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export interface ConfidenceOptions {
  /** True when a model judge produced (and double-checked) the relation. */
  judgeRan: boolean;
  weights?: typeof DEFAULT_CONFIDENCE_WEIGHTS;
}

/** Returns the blended, capped confidence and the signals with `capsApplied` filled in. */
export function computeConfidence(
  signals: Omit<ConfidenceSignals, 'capsApplied'>,
  options: ConfidenceOptions,
): { confidence: number; signals: ConfidenceSignals } {
  const w = options.weights ?? DEFAULT_CONFIDENCE_WEIGHTS;
  let confidence =
    w.retrieval * clamp01(signals.retrievalScore) +
    w.quote * (signals.quoteVerified ? 1 : 0) +
    w.judgeAgreement * clamp01(signals.judgeAgreement) +
    w.top1Gap * clamp01(signals.top1Gap) +
    w.extractionQuality * clamp01(signals.extractionQuality) +
    w.llmSelfReport * clamp01(signals.llmSelfReport);

  const capsApplied: string[] = [];
  const cap = (name: string, max: number) => {
    capsApplied.push(name);
    confidence = Math.min(confidence, max);
  };
  if (!signals.quoteVerified) cap('quote_not_verified', CAPS.quoteNotVerified);
  if (options.judgeRan && signals.judgeAgreement < 1) {
    cap('judge_disagreement', CAPS.judgeDisagreement);
  }
  if (signals.extractionQuality < LOW_QUALITY_BELOW)
    cap('low_quality_source', CAPS.lowQualitySource);
  if (!options.judgeRan) cap('lexical_only', CAPS.lexicalOnly);

  return {
    confidence: Math.round(confidence * 100) / 100,
    signals: { ...signals, capsApplied },
  };
}
