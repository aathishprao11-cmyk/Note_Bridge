import {
  verifyQuoteText,
  type Chunk,
  type GroundedAnswer,
  type GroundingService,
  type RetrievalService,
} from '@gyan/core';

/**
 * Stand-ins until Phase 1b implements retrieval and grounding (owner: Laptop A). They are honest,
 * not fake: retrieval always abstains and says why, and grounding only does the checks that need
 * no model. Replace them in app.ts when the real services land; no plugin code changes.
 */
export const placeholderRetrieval: RetrievalService = {
  async retrieve() {
    return {
      hits: [],
      abstain: true,
      abstainReason: 'Retrieval is not implemented yet (Phase 1b).',
    };
  },
};

export const placeholderGrounding: GroundingService = {
  verifyQuote(chunk: Chunk, quote: string): boolean {
    return verifyQuoteText(chunk.text, quote, 0.9);
  },
  validateAnswer(answer: GroundedAnswer, retrieved: Chunk[]): GroundedAnswer {
    const ids = new Set(retrieved.map((c) => c.id));
    return {
      ...answer,
      citations: answer.citations.map((c) =>
        ids.has(c.chunkId) ? c : { ...c, status: 'unverified' as const },
      ),
    };
  },
  async checkClaim() {
    return 'n/a';
  },
};
