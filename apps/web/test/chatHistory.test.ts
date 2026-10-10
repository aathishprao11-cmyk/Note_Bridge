import { describe, expect, it } from 'vitest';
import { newAssistantMessage, toHistory, type ChatMessage } from '../src/lib/chat';

describe('toHistory', () => {
  it('keeps user turns and finished, non-abstained answers only', () => {
    const done = { ...newAssistantMessage('a1'), status: 'done' as const, text: 'Answer' };
    const msgs: ChatMessage[] = [
      { id: 'u1', role: 'user', text: 'Q1' },
      done,
      { id: 'u2', role: 'user', text: 'Q2' },
      { ...done, id: 'a2', text: 'Nothing found', abstained: true },
      { id: 'u3', role: 'user', text: 'Q3' },
      newAssistantMessage('a3'),
    ];
    expect(toHistory(msgs)).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Q2' },
      { role: 'user', content: 'Q3' },
    ]);
  });
});
