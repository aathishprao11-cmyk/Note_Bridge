/**
 * Web-side mirror of the chat stream (apps/server/src/agent/types.ts). Proposed for docs/API.md in
 * docs/CONTRACT_REQUESTS.md. `Citation` and `Usage` are the shared contract types.
 */
import type { Citation, Usage } from '@gyan/core';

export type CitationProblem = 'not_returned' | 'page_mismatch' | 'quote_mismatch';

export interface ChatCitation extends Citation {
  /** 1-based number used by the `[n]` markers in the answer text. */
  n: number;
  verified: boolean;
  reason?: CitationProblem;
  documentTitle?: string;
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-started'; id: string; name: string; input: { query: string } }
  | {
      type: 'tool-finished';
      id: string;
      name: string;
      summary: string;
      pages: number[];
      resultCount: number;
    }
  | ({ type: 'usage' } & Usage)
  | {
      type: 'done';
      text: string;
      citations: ChatCitation[];
      confidence: number;
      abstained: boolean;
      unverifiedCount: number;
      strippedCount: number;
    }
  | { type: 'error'; code: string; message: string };

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}
