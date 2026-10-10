import type { ChatEventPayload, Citation } from '@gyan/core';
import type { ToolRunner } from './tools';

/**
 * Study-agent types. The wire format is the frozen contract in packages/core/src/api-contract.ts
 * (`ChatEvent`); nothing here redefines it. The pipeline emits contract events minus `session`,
 * which the route adds.
 */

export type CitationProblem = 'not_returned' | 'page_mismatch' | 'quote_mismatch';

/** A citation an agent proposes. `status` is decided by validateAnswer, never by the agent. */
export type DraftCitation = Omit<Citation, 'status'>;

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
  /** Earlier turns of the same session, oldest first. */
  history?: ChatMessageIn[];
}

export type ChatEvent = Exclude<ChatEventPayload, { type: 'session' }>;

export type AgentEvent =
  Exclude<ChatEvent, { type: 'done' | 'error' }> | { type: 'draft'; draft: AnswerDraft };

export interface Agent {
  readonly id: string;
  /** Streams events. Must end with a `draft`; the pipeline validates it and emits `done`. */
  run(req: ChatRequest, tools: ToolRunner): AsyncGenerator<AgentEvent>;
}
