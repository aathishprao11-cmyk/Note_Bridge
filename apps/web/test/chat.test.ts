import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  citationLabel,
  confidenceLabel,
  finishStreaming,
  formatTokens,
  newAssistantMessage,
  splitMarkers,
  totalUsage,
  unverifiedReason,
  type ChatMessage,
} from '../src/lib/chat';
import type { ChatCitation } from '../src/lib/chatTypes';

const cite = (over: Partial<ChatCitation> = {}): ChatCitation => ({
  n: 1,
  documentId: 'doc-book',
  chunkId: 'c1',
  page: 41,
  printedPage: 41,
  quote: 'Displacement is a vector.',
  verified: true,
  documentTitle: 'Physics',
  ...over,
});

describe('applyEvent', () => {
  it('appends text deltas', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'text', delta: 'Hello ' });
    m = applyEvent(m, { type: 'text', delta: 'world' });
    expect(m.text).toBe('Hello world');
    expect(m.status).toBe('streaming');
  });

  it('tracks a tool call from running to done with its "Looked up pages" line', () => {
    let m = newAssistantMessage('a1');
    const query = { query: 'acceleration' };
    m = applyEvent(m, { type: 'tool-started', id: 't1', name: 'search_course', input: query });
    expect(m.tools[0]).toMatchObject({ status: 'running', query: 'acceleration' });
    m = applyEvent(m, {
      type: 'tool-finished',
      id: 't1',
      name: 'search_course',
      summary: 'Looked up pages 41-48',
      pages: [41, 48],
      resultCount: 8,
    });
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0]).toMatchObject({ status: 'done', summary: 'Looked up pages 41-48' });
  });

  it('keeps the latest usage (cumulative), not a running sum', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'usage', inputTokens: 100, outputTokens: 0 });
    m = applyEvent(m, { type: 'usage', inputTokens: 100, outputTokens: 40 });
    expect(m.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
  });

  it('replaces streamed text with the validated text on done, so stripped markers vanish', () => {
    let m = newAssistantMessage('a1');
    m = applyEvent(m, { type: 'text', delta: 'Real [1]. Fake [2].' });
    m = applyEvent(m, {
      type: 'done',
      text: 'Real [1]. Fake.',
      citations: [cite()],
      confidence: 0.8,
      abstained: false,
      unverifiedCount: 0,
      strippedCount: 1,
    });
    expect(m.text).toBe('Real [1]. Fake.');
    expect(m.status).toBe('done');
    expect(m.strippedCount).toBe(1);
    expect(m.citations).toHaveLength(1);
  });

  it('records an error event, and never mutates its input', () => {
    const before = newAssistantMessage('a1');
    const m = applyEvent(before, { type: 'error', code: 'x', message: 'nope' });
    expect(m).toMatchObject({ status: 'error', error: 'nope' });
    expect(before.status).toBe('streaming');
  });

  it('finishStreaming stops a streaming message and leaves finished ones alone', () => {
    const streaming = newAssistantMessage('a1');
    expect(finishStreaming(streaming).status).toBe('done');
    expect(finishStreaming(streaming, 'lost').status).toBe('error');
    const done = { ...streaming, status: 'done' as const };
    expect(finishStreaming(done, 'lost')).toBe(done);
  });
});

describe('token counter helpers', () => {
  const asst = (i: number, o: number): ChatMessage => ({
    ...newAssistantMessage('a'),
    usage: { inputTokens: i, outputTokens: o },
  });

  it('totals usage across all answers and ignores user messages', () => {
    const msgs: ChatMessage[] = [
      { id: 'u1', role: 'user', text: 'hi' },
      asst(100, 40),
      { id: 'u2', role: 'user', text: 'again' },
      asst(200, 60),
    ];
    expect(totalUsage(msgs)).toEqual({ inputTokens: 300, outputTokens: 100, total: 400 });
    expect(totalUsage([])).toEqual({ inputTokens: 0, outputTokens: 0, total: 0 });
  });

  it('formats large counts compactly', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1500)).toBe('1.5k');
  });
});

describe('citations in answer text', () => {
  it('splits text around known markers, leaving unknown markers as plain text', () => {
    expect(splitMarkers('A [1] and B [2].', [cite({ n: 1 }), cite({ n: 2 })])).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'cite', n: 1 },
      { kind: 'text', text: ' and B ' },
      { kind: 'cite', n: 2 },
      { kind: 'text', text: '.' },
    ]);
    expect(splitMarkers('See [3] here', [cite({ n: 1 })])).toEqual([
      { kind: 'text', text: 'See [3] here' },
    ]);
  });

  it('labels a citation with the document title and printed page', () => {
    expect(citationLabel(cite({ printedPage: 43 }))).toBe('Physics, p. 43');
    expect(citationLabel(cite({ documentTitle: undefined }))).toBe('Source, p. 41');
  });

  it('explains why a citation is unverified', () => {
    const bad = (reason?: ChatCitation['reason']) => cite({ verified: false, reason });
    expect(unverifiedReason(bad('not_returned'))).toMatch(/No lookup/);
    expect(unverifiedReason(bad('page_mismatch'))).toMatch(/page/);
    expect(unverifiedReason(bad('quote_mismatch'))).toMatch(/quoted/);
    expect(unverifiedReason(bad())).toMatch(/could not be checked/);
    expect(confidenceLabel(0.826)).toBe('confidence 83%');
  });
});
