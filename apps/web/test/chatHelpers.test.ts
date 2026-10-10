import { describe, expect, it } from 'vitest';
import { ChatEvent, demo } from '@gyan/core';
import {
  applyEvent,
  citationLabel,
  confidenceLabel,
  formatTokens,
  isUnverified,
  newAssistantMessage,
  splitMarkers,
  totalUsage,
  type ChatMessage,
} from '../src/lib/chat';
import type { Citation } from '../src/lib/chatTypes';

const cite = (over: Partial<Citation> = {}): Citation => ({
  documentId: 'doc_book',
  chunkId: 'chk_02',
  page: 5,
  printedPage: 2,
  quote: 'Acceleration is the rate of change of velocity.',
  status: 'verified',
  ...over,
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
  it('splits text around markers that have a citation, leaving others as plain text', () => {
    expect(splitMarkers('A [1] and B [2].', [cite(), cite()])).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'cite', n: 1 },
      { kind: 'text', text: ' and B ' },
      { kind: 'cite', n: 2 },
      { kind: 'text', text: '.' },
    ]);
    expect(splitMarkers('See [3] and [0] here', [cite()])).toEqual([
      { kind: 'text', text: 'See [3] and [0] here' },
    ]);
  });

  it('labels a chip with the printed page, falling back to the PDF page', () => {
    expect(citationLabel(cite({ printedPage: 3 }))).toBe('p. 3');
    expect(citationLabel(cite({ printedPage: null, page: 7 }))).toBe('p. 7');
  });

  it('treats only status "unverified" as unverified', () => {
    expect(isUnverified(cite({ status: 'unverified' }))).toBe(true);
    expect(isUnverified(cite({ status: 'verified' }))).toBe(false);
  });

  it('formats confidence, and nothing when the server abstained (null)', () => {
    expect(confidenceLabel(0.826)).toBe('confidence 83%');
    expect(confidenceLabel(null)).toBe('');
  });
});

describe('the frozen contract fixtures drive the reducer', () => {
  it('replays every canned example into a finished message', () => {
    expect(demo.chatExamples.length).toBeGreaterThan(0);
    for (const ex of demo.chatExamples) {
      let m = newAssistantMessage('a');
      for (const event of ex.events) {
        expect(ChatEvent.safeParse(event).success).toBe(true);
        m = applyEvent(m, event);
      }
      expect(m.status).toBe('done');
      expect(m.text.length).toBeGreaterThan(0);
    }
  });

  it('includes an unverified citation and an unverified calculation to render', () => {
    const done = demo.chatExamples.flatMap((e) => e.events).filter((e) => e.type === 'done');
    expect(done.some((e) => e.citations.some((c) => c.status === 'unverified'))).toBe(true);
    expect(done.some((e) => e.unverifiedCalculation)).toBe(true);
  });
});
