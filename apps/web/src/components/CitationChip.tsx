import type { Citation } from '../lib/chatTypes';
import { citationLabel, isUnverified, unverifiedReason } from '../lib/chat';

const CHIP_OK = 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100';
// Unverified: dashed amber border, struck-through label and a warning mark, so it can never be
// mistaken for a checked source (the style does not rely on colour alone).
const CHIP_BAD = 'border-dashed border-amber-500 bg-amber-50 text-amber-900 line-through';

export function CitationChip({
  citation,
  n,
  compact,
  active,
  onToggle,
}: {
  citation: Citation;
  /** The 1-based `[n]` number of this citation in the answer. */
  n: number;
  /** Just the number, for use inline in the answer text. */
  compact?: boolean;
  active?: boolean;
  onToggle: (n: number) => void;
}) {
  const bad = isUnverified(citation);
  return (
    <button
      type="button"
      onClick={() => onToggle(n)}
      aria-pressed={active}
      data-testid="citation-chip"
      data-status={citation.status}
      title={bad ? `Unverified citation. ${unverifiedReason()}` : citationLabel(citation)}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${
        bad ? CHIP_BAD : CHIP_OK
      } ${active ? 'ring-2 ring-slate-400' : ''}`}
    >
      {bad && <span aria-hidden="true">⚠</span>}
      <span>{compact ? n : `${n} · ${citationLabel(citation)}`}</span>
      {bad && <span className="sr-only">unverified citation</span>}
    </button>
  );
}
