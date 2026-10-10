import { useState } from 'react';
import {
  confidenceLabel,
  formatTokens,
  isUnverified,
  splitMarkers,
  unverifiedReason,
  type AssistantMessage,
  type TokenTotals,
  type ToolLine,
} from '../lib/chat';
import { CitationChip } from './CitationChip';

export function ToolEvents({ tools }: { tools: ToolLine[] }) {
  if (tools.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label="Lookups">
      {tools.map((t) => (
        <li
          key={t.index}
          data-testid="tool-event"
          className="flex items-center gap-2 text-xs text-slate-500"
        >
          <span aria-hidden="true">
            {t.status === 'running' ? '⏳' : t.ok === false ? '⚠' : '🔎'}
          </span>
          <span>{t.summary}</span>
        </li>
      ))}
    </ul>
  );
}

export function TokenCounter({ totals }: { totals: TokenTotals }) {
  return (
    <p
      data-testid="token-counter"
      className="text-xs text-slate-500"
      title={`${totals.inputTokens} in, ${totals.outputTokens} out`}
    >
      Tokens: {formatTokens(totals.total)} ({formatTokens(totals.inputTokens)} in /{' '}
      {formatTokens(totals.outputTokens)} out)
    </p>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
        {text}
      </p>
    </div>
  );
}

export function AssistantBubble({ message }: { message: AssistantMessage }) {
  const [openN, setOpenN] = useState<number | null>(null);
  const toggle = (n: number) => setOpenN((cur) => (cur === n ? null : n));
  const segments = splitMarkers(message.text, message.citations);
  const open = openN === null ? undefined : message.citations[openN - 1];
  const streaming = message.status === 'streaming';
  const unverified = message.citations.filter(isUnverified).length;

  return (
    <div className="flex">
      <div
        className="max-w-[90%] space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
        data-testid="assistant-message"
        data-status={message.status}
      >
        <ToolEvents tools={message.tools} />

        {(message.text || streaming) && (
          <p className="whitespace-pre-wrap text-sm text-slate-900">
            {segments.map((s, i) => {
              if (s.kind === 'text') return <span key={i}>{s.text}</span>;
              const c = message.citations[s.n - 1];
              return c ? (
                <span key={i} className="mx-0.5 align-baseline">
                  <CitationChip
                    citation={c}
                    n={s.n}
                    compact
                    active={openN === s.n}
                    onToggle={toggle}
                  />
                </span>
              ) : null;
            })}
            {streaming && (
              <span aria-label="Answering" className="ml-0.5 animate-pulse">
                ▍
              </span>
            )}
          </p>
        )}

        {message.status === 'error' && (
          <p role="alert" className="text-sm text-red-700">
            {message.error ?? 'Something went wrong.'}
          </p>
        )}

        {message.status === 'done' && message.abstained && (
          <p className="text-xs text-slate-500">No sources were found, so nothing is cited.</p>
        )}

        {message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Sources">
            {message.citations.map((c, i) => (
              <CitationChip
                key={i}
                citation={c}
                n={i + 1}
                active={openN === i + 1}
                onToggle={toggle}
              />
            ))}
          </div>
        )}

        {open && (
          <blockquote
            data-testid="citation-quote"
            className={`border-l-2 pl-2 text-xs ${
              isUnverified(open)
                ? 'border-amber-500 text-amber-900'
                : 'border-blue-300 text-slate-700'
            }`}
          >
            “{open.quote}”
            {isUnverified(open) && (
              <span className="mt-1 block font-medium">
                Unverified citation. {unverifiedReason()}
              </span>
            )}
          </blockquote>
        )}

        {message.status === 'done' && unverified > 0 && (
          <p data-testid="validation-note" className="text-xs text-amber-800">
            {unverified} unverified citation{unverified === 1 ? '' : 's'} marked.
          </p>
        )}

        {message.status === 'done' && message.unverifiedCalculation && (
          <p data-testid="calc-note" className="text-xs text-amber-800">
            Unverified calculation: a number here was not checked by running code.
          </p>
        )}

        {message.status === 'done' && message.confidence !== null && (
          <p className="text-xs text-slate-500">{confidenceLabel(message.confidence)}</p>
        )}
      </div>
    </div>
  );
}
