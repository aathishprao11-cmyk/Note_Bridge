/**
 * Pure chat state for the Chat page: the reducer that folds stream events into messages, token
 * totals, and the helpers that turn answer text into citation chips. No fetch, no React, so it is
 * unit-tested in the repo's node-environment Vitest. The network client is in `chatStream.ts`.
 */
import type { ChatCitation, ChatEvent, ChatHistoryItem, CitationProblem } from './chatTypes';

export interface ToolLine {
  id: string;
  name: string;
  query: string;
  status: 'running' | 'done';
  summary?: string;
  pages?: number[];
  resultCount?: number;
}

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  text: string;
  status: 'streaming' | 'done' | 'error';
  tools: ToolLine[];
  citations: ChatCitation[];
  /** Latest usage event: cumulative for this answer, not a delta. */
  usage: { inputTokens: number; outputTokens: number };
  confidence?: number;
  abstained: boolean;
  unverifiedCount: number;
  strippedCount: number;
  error?: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

export function newAssistantMessage(id: string): AssistantMessage {
  return {
    id,
    role: 'assistant',
    text: '',
    status: 'streaming',
    tools: [],
    citations: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    abstained: false,
    unverifiedCount: 0,
    strippedCount: 0,
  };
}

/** Fold one stream event into an assistant message. Pure: returns a new object. */
export function applyEvent(msg: AssistantMessage, ev: ChatEvent): AssistantMessage {
  switch (ev.type) {
    case 'text':
      return { ...msg, text: msg.text + ev.delta };
    case 'tool-started':
      return {
        ...msg,
        tools: [
          ...msg.tools,
          { id: ev.id, name: ev.name, query: ev.input.query, status: 'running' },
        ],
      };
    case 'tool-finished':
      return {
        ...msg,
        tools: msg.tools.map((t) =>
          t.id === ev.id
            ? {
                ...t,
                status: 'done',
                summary: ev.summary,
                pages: ev.pages,
                resultCount: ev.resultCount,
              }
            : t,
        ),
      };
    case 'usage':
      return { ...msg, usage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens } };
    case 'done':
      return {
        ...msg,
        // The validated text replaces whatever was streamed, so a stripped citation disappears.
        text: ev.text,
        status: 'done',
        citations: ev.citations,
        confidence: ev.confidence,
        abstained: ev.abstained,
        unverifiedCount: ev.unverifiedCount,
        strippedCount: ev.strippedCount,
      };
    case 'error':
      return { ...msg, status: 'error', error: ev.message };
  }
}

/** Mark a message that is still streaming as stopped (user pressed Stop, or the link dropped). */
export function finishStreaming(msg: AssistantMessage, error?: string): AssistantMessage {
  if (msg.status !== 'streaming') return msg;
  return error ? { ...msg, status: 'error', error } : { ...msg, status: 'done' };
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  total: number;
}

export function totalUsage(messages: ChatMessage[]): TokenTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    inputTokens += m.usage.inputTokens;
    outputTokens += m.usage.outputTokens;
  }
  return { inputTokens, outputTokens, total: inputTokens + outputTokens };
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Prior finished turns, in the shape the endpoint accepts. Unfinished or failed answers are left out. */
export function toHistory(messages: ChatMessage[]): ChatHistoryItem[] {
  return messages
    .filter((m) => m.role === 'user' || (m.status === 'done' && !m.abstained))
    .map((m) => ({ role: m.role, content: m.text }));
}

export type TextSegment = { kind: 'text'; text: string } | { kind: 'cite'; n: number };

/** Split answer text on `[n]` markers. A marker with no matching citation stays plain text. */
export function splitMarkers(text: string, citations: ChatCitation[]): TextSegment[] {
  const known = new Set(citations.map((c) => c.n));
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (!known.has(n)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'cite', n });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function citationLabel(c: ChatCitation): string {
  return `${c.documentTitle ?? 'Source'}, p. ${c.printedPage}`;
}

const REASONS: Record<CitationProblem, string> = {
  not_returned: 'No lookup returned this source.',
  page_mismatch: 'The page number does not match the source that was retrieved.',
  quote_mismatch: 'The quoted text was not found in the retrieved source.',
};

export function unverifiedReason(c: ChatCitation): string {
  return c.reason ? REASONS[c.reason] : 'This citation could not be checked.';
}

export function confidenceLabel(confidence: number | undefined): string {
  return confidence === undefined ? '' : `confidence ${Math.round(confidence * 100)}%`;
}
