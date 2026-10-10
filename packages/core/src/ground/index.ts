import type { Chunk, Citation, ClaimVerdict } from '../types';

export * from './quote-verify';
export * from './answer-validate';

/** Interface frozen in the contract step. Implemented in Phase 1b (owner: Laptop A). */

export interface GroundedAnswer {
  text: string;
  citations: Citation[];
  /** Computed (not LLM-reported) confidence, 0..1. */
  confidence: number;
  abstained: boolean;
}

export interface GroundingService {
  /** True only if the quote fuzzy-matches the chunk text at or above QUOTE_MATCH_MIN. */
  verifyQuote(chunk: Chunk, quote: string): boolean;
  /** Mark citations not in the retrieved set as unverified (never silently keep them). */
  validateAnswer(answer: GroundedAnswer, retrieved: Chunk[]): GroundedAnswer;
  /** Second pass: does the snippet support this conflict or correction claim? */
  checkClaim(claim: string, snippet: string): Promise<ClaimVerdict>;
}

/** Phase 0 name, kept as an alias. */
export type Grounder = GroundingService;

/** Starting weights from BRIEF 9.3. They belong in config and get tuned with the eval harness. */
export const DEFAULT_CONFIDENCE_WEIGHTS = {
  retrieval: 0.3,
  quote: 0.25,
  judgeAgreement: 0.2,
  top1Gap: 0.1,
  extractionQuality: 0.1,
  llmSelfReport: 0.05,
} as const;
