import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { AssistantBubble, TokenCounter, UserBubble } from '../components/ChatParts';
import { PanelSlot } from '../features/PanelSlot';
import {
  applyEvent,
  finishStreaming,
  newAssistantMessage,
  toHistory,
  totalUsage,
  type AssistantMessage,
  type ChatMessage,
} from '../lib/chat';
import { streamChat } from '../lib/chatStream';

const SUGGESTIONS = [
  'What is acceleration?',
  'Explain free fall',
  'How do I find displacement from a velocity-time graph?',
];

/** Streaming study chat. Answers cite the course material; unverified citations are flagged. */
export function Chat() {
  const { courseId = '' } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const counter = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const updateAssistant = useCallback(
    (id: string, fn: (m: AssistantMessage) => AssistantMessage) => {
      setMessages((all) => all.map((m) => (m.role === 'assistant' && m.id === id ? fn(m) : m)));
    },
    [],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      const history = toHistory(messages);
      counter.current += 1;
      const userId = `u${counter.current}`;
      const botId = `a${counter.current}`;
      setMessages((all) => [
        ...all,
        { id: userId, role: 'user', text },
        newAssistantMessage(botId),
      ]);
      setInput('');
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChat({
          courseId,
          message: text,
          history,
          signal: controller.signal,
          onEvent: (event) => updateAssistant(botId, (m) => applyEvent(m, event)),
        });
        updateAssistant(botId, (m) => finishStreaming(m, 'The answer stream ended early.'));
      } catch (err) {
        if (controller.signal.aborted) {
          updateAssistant(botId, (m) => finishStreaming(m));
        } else {
          const message = err instanceof Error ? err.message : String(err);
          updateAssistant(botId, (m) => finishStreaming({ ...m, status: 'streaming' }, message));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, courseId, messages, updateAssistant],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const totals = totalUsage(messages);

  return (
    <section className="space-y-3" aria-label="Study chat">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ask your course</h2>
        <TokenCounter totals={totals} />
      </div>

      <div
        className="h-[28rem] space-y-3 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3"
        aria-live="polite"
        data-testid="chat-log"
      >
        {messages.length === 0 && (
          <div className="space-y-2 text-sm text-slate-500">
            <p>Ask a question. Answers are built from your slides and textbook, with sources.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <UserBubble key={m.id} text={m.text} />
          ) : (
            <AssistantBubble key={m.id} message={m} />
          ),
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Your question
        </label>
        <input
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your course…"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          maxLength={4000}
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
      <PanelSlot slot="chat" />
    </section>
  );
}
