import { useState } from 'react';
import {
  confidenceLabel,
  formatTokens,
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
          key={t.id}
          data-testid="tool-event"
          className="flex items-center gap-2 text-xs text-slate-500"
        >
          <span aria-hidden="true">{t.status === 'running' ? '⏳' : '🔎'}</span>
          <span>{t.status === 'running' ? `Searching for “${t.query}”…` : t.summary}</span>
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
      title={`${totals.inputTokens} in, ${totals.outputTokens} out (estimated)`}
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
  const open = message.citations.find((c) => c.n === openN);
  const streaming = message.status === 'streaming';

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
              const c = message.citations.find((x) => x.n === s.n);
              return c ? (
                <span key={i} className="mx-0.5 align-baseline">
                  <CitationChip citation={c} compact active={openN === c.n} onToggle={toggle} />
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
            {message.citations.map((c) => (
              <CitationChip key={c.n} citation={c} active={openN === c.n} onToggle={toggle} />
            ))}
          </div>
        )}

        {open && (
          <blockquote
            data-testid="citation-quote"
            className={`border-l-2 pl-2 text-xs ${
              open.verified ? 'border-blue-300 text-slate-700' : 'border-amber-500 text-amber-900'
            }`}
          >
            “{open.quote}”
            {!open.verified && (
              <span className="mt-1 block font-medium">
                Unverified citation. {unverifiedReason(open)}
              </span>
            )}
          </blockquote>
        )}

        {message.status === 'done' &&
          (message.unverifiedCount > 0 || message.strippedCount > 0) && (
            <p data-testid="validation-note" className="text-xs text-amber-800">
              {message.unverifiedCount > 0 &&
                `${message.unverifiedCount} unverified citation${message.unverifiedCount === 1 ? '' : 's'} marked. `}
              {message.strippedCount > 0 &&
                `${message.strippedCount} citation${message.strippedCount === 1 ? '' : 's'} removed because no lookup returned ${message.strippedCount === 1 ? 'it' : 'them'}.`}
            </p>
          )}

        {message.status === 'done' && message.confidence !== undefined && !message.abstained && (
          <p className="text-xs text-slate-500">{confidenceLabel(message.confidence)}</p>
        )}
      </div>
    </div>
  );
}
