import type { Chunk, Citation } from '../types';

/** Interface frozen in the contract step. Implemented in Phase 1b (owner: Laptop A). */

export interface RetrievalQuery {
  courseId: string;
  text: string;
  /** Optional hint: restrict to these document ids. */
  documentIds?: string[];
  topK?: number;
}

export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
}

export interface RetrievalResult {
  hits: RetrievedChunk[];
  /** True when evidence is too weak to answer; callers must abstain. */
  abstain: boolean;
  abstainReason?: string;
}

export interface RetrievalService {
  retrieve(q: RetrievalQuery): Promise<RetrievalResult>;
}

/** Phase 0 name, kept as an alias. */
export type Retriever = RetrievalService;

export type { Citation };
