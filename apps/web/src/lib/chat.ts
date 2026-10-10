/**
 * Pure chat state for the Chat page: the reducer that folds stream events into messages, token
 * totals, and the helpers that turn answer text into citation chips. No fetch, no React, so it is
 * unit-tested in the repo's node-environment Vitest. The network client is in `chatStream.ts`.
 * Event and citation types are the frozen contract's (`@gyan/core`).
 */
import type { ChatEvent, Citation } from './chatTypes';

export interface ToolLine {
  /** Position of the call in this answer; the contract's tool events carry no id. */
  index: number;
  name: string;
  query: string;
  status: 'running' | 'done';
  /** Running: "Searching your material for ...". Done: "Looked up pages 41-48". */
  summary: string;
  ok?: boolean;
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
  /** `citations[n - 1]` is the chip for the `[n]` marker in `text`. */
  citations: Citation[];
  /** Latest usage event: cumulative for this answer, not a delta. */
  usage: { inputTokens: number; outputTokens: number };
  /** Computed by the server; null when it abstained. */
  confidence: number | null;
  abstained: boolean;
  unverifiedCalculation: boolean;
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
    confidence: null,
    abstained: false,
    unverifiedCalculation: false,
  };
}

function queryOf(input: Record<string, unknown>): string {
  const q = input.query;
  return typeof q === 'string' ? q : '';
}

/** Fold one stream event into an assistant message. Pure: returns a new object. */
export function applyEvent(msg: AssistantMessage, ev: ChatEvent): AssistantMessage {
  switch (ev.type) {
    case 'session':
      return msg; // the page reads the session id itself
    case 'text':
      return { ...msg, text: msg.text + ev.delta };
    case 'tool-started':
      return {
        ...msg,
        tools: [
          ...msg.tools,
          {
            index: msg.tools.length,
            name: ev.call.name,
            query: queryOf(ev.call.input),
            status: 'running',
            summary: ev.call.summary,
          },
        ],
      };
    case 'tool-finished': {
      // Finish the oldest running call with this name; the contract has no per-call id.
      const at = msg.tools.findIndex((t) => t.status === 'running' && t.name === ev.call.name);
      const done: ToolLine = {
        index: at >= 0 ? (msg.tools[at]?.index ?? at) : msg.tools.length,
        name: ev.call.name,
        query: queryOf(ev.call.input),
        status: 'done',
        summary: ev.call.summary,
        ok: ev.ok,
      };
      return {
        ...msg,
        tools: at >= 0 ? msg.tools.map((t, i) => (i === at ? done : t)) : [...msg.tools, done],
      };
    }
    case 'usage':
      return { ...msg, usage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens } };
    case 'done':
      return {
        ...msg,
        // The validated text replaces whatever was streamed, so a stripped citation disappears.
        // `id` stays the local id: the page finds its message by it while the stream is open.
        text: ev.content,
        status: 'done',
        citations: ev.citations,
        confidence: ev.confidence,
        abstained: ev.abstained,
        unverifiedCalculation: ev.unverifiedCalculation,
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

export type TextSegment = { kind: 'text'; text: string } | { kind: 'cite'; n: number };

/** Split answer text on `[n]` markers. A marker with no matching citation stays plain text. */
export function splitMarkers(text: string, citations: Citation[]): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n < 1 || n > citations.length) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'cite', n });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** What a chip shows. The printed page is what the student sees in the book; fall back to the PDF page. */
export function citationLabel(c: Citation): string {
  return `p. ${c.printedPage ?? c.page}`;
}

export function isUnverified(c: Citation): boolean {
  return c.status === 'unverified';
}

export function unverifiedReason(): string {
  return 'The source for this citation could not be confirmed against the retrieved pages.';
}

export function confidenceLabel(confidence: number | null): string {
  return confidence === null ? '' : `confidence ${Math.round(confidence * 100)}%`;
}
