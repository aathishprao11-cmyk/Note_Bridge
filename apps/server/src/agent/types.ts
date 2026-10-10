import type { Citation, Usage } from '@gyan/core';
import type { ToolRunner } from './tools';

/**
 * Chat types for POST /api/courses/:courseId/chat. The SSE payloads are proposed for docs/API.md
 * in docs/CONTRACT_REQUESTS.md; `Citation` and `Usage` come from the shared contract unchanged.
 */

export type CitationProblem = 'not_returned' | 'page_mismatch' | 'quote_mismatch';

/** A citation as sent to the client: the shared Citation plus its validation result. */
export interface ChatCitation extends Citation {
  /** 1-based number used by the `[n]` markers in the answer text. */
  n: number;
  verified: boolean;
  /** Why it is unverified. Only present when `verified` is false. */
  reason?: CitationProblem;
  documentTitle?: string;
}

/** What an agent proposes before validation. */
export type DraftCitation = Citation & { documentTitle?: string };

export interface AnswerDraft {
  /** Answer text; `[n]` marks the n-th entry of `citations` (1-based). */
  text: string;
  citations: DraftCitation[];
  abstained: boolean;
}

export interface ChatMessageIn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  courseId: string;
  message: string;
  history?: ChatMessageIn[];
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | {
      type: 'tool-started';
      id: string;
      name: string;
      input: { query: string };
    }
  | {
      type: 'tool-finished';
      id: string;
      name: string;
      /** Human-readable line, for example "Looked up pages 41-48". */
      summary: string;
      pages: number[];
      resultCount: number;
    }
  | ({ type: 'usage' } & Usage)
  | {
      type: 'done';
      /** Final validated text. Replaces whatever was streamed. */
      text: string;
      citations: ChatCitation[];
      /** Computed from tool results and validation, never reported by a model. */
      confidence: number;
      abstained: boolean;
      unverifiedCount: number;
      strippedCount: number;
    }
  | { type: 'error'; code: string; message: string };

export type AgentEvent =
  Exclude<ChatEvent, { type: 'done' | 'error' }> | { type: 'draft'; draft: AnswerDraft };

export interface Agent {
  readonly id: string;
  /** Streams events. Must end with a `draft`; the pipeline validates it and emits `done`. */
  run(req: ChatRequest, tools: ToolRunner): AsyncGenerator<AgentEvent>;
}
