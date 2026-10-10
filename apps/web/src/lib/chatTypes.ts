/**
 * Chat wire types. They come straight from the frozen contract (packages/core/src/api-contract.ts);
 * the web app keeps no copy of them, so a contract change fails the typecheck here.
 */
import type { ChatEventPayload, Citation } from '@gyan/core';

export type ChatEvent = ChatEventPayload;
export type { Citation };

/** Earlier turns, for display only: the server keeps the history by `sessionId`. */
export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}
