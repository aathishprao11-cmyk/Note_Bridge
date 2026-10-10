/**
 * Network side of the chat: POST /api/courses/:courseId/chat answers with an SSE stream. The
 * incremental parser is pure and tested; `streamChat` is the only function that touches fetch.
 */
import { ApiError } from './api';
import type { ChatEvent, ChatHistoryItem } from './chatTypes';

/**
 * Feed raw text as it arrives. Returns the complete events found and the unconsumed tail to
 * prepend to the next chunk. Frames end with a blank line (LF or CRLF); multi-line `data:` fields
 * are joined; comment and keep-alive frames are ignored; a malformed frame is skipped.
 */
export function parseSseBuffer(buffer: string): { events: ChatEvent[]; rest: string } {
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = frames.pop() ?? '';
  const events: ChatEvent[] = [];
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as ChatEvent;
      if (parsed && typeof parsed.type === 'string') events.push(parsed);
    } catch {
      // skip the bad frame instead of killing the whole answer
    }
  }
  return { events, rest };
}

export interface StreamChatOptions {
  courseId: string;
  message: string;
  history: ChatHistoryItem[];
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}

/** POST the question and stream the events. Rejects with ApiError on an HTTP error. */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const res = await fetch(`/api/courses/${encodeURIComponent(opts.courseId)}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ message: opts.message, history: opts.history }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res
      .json()
      .then((b: unknown) => b as { error?: { code?: string; message?: string } } | null)
      .catch(() => null);
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'http_error',
      body?.error?.message ?? `Chat request failed: HTTP ${res.status}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) opts.onEvent(event);
  }
  // A final frame that arrived without its trailing blank line.
  for (const event of parseSseBuffer(`${buffer}\n\n`).events) opts.onEvent(event);
}
