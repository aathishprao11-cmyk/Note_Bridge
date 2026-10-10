/** Small shared presentational primitives for the Phase 1b screens. */
import type { ReactNode } from 'react';
import type { Relation } from '../lib/types';
import { formatConfidence, relationLabel } from '../lib/format';

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-slate-200"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

const RELATION_STYLE: Record<Relation, string> = {
  covers: 'bg-green-100 text-green-800',
  extends: 'bg-blue-100 text-blue-800',
  conflicts: 'bg-red-100 text-red-800',
  professor_only: 'bg-amber-100 text-amber-800',
  book_only: 'bg-amber-100 text-amber-800',
};

export function RelationBadge({ relation }: { relation: Relation }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${RELATION_STYLE[relation]}`}>
      {relationLabel(relation)}
    </span>
  );
}

export function ConfidenceTag({ confidence }: { confidence: number }) {
  return <span className="text-xs text-slate-500">confidence {formatConfidence(confidence)}</span>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {message}
    </p>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="text-sm text-slate-500">{label}</p>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}
