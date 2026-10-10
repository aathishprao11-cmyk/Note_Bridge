import type { ChatCitation } from '../lib/chatTypes';
import { citationLabel, unverifiedReason } from '../lib/chat';

const CHIP_OK = 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100';
// Unverified: dashed amber border, struck-through label and a warning mark, so it can never be
// mistaken for a checked source (the style does not rely on colour alone).
const CHIP_BAD = 'border-dashed border-amber-500 bg-amber-50 text-amber-900 line-through';

export function CitationChip({
  citation,
  compact,
  active,
  onToggle,
}: {
  citation: ChatCitation;
  /** Just the number, for use inline in the answer text. */
  compact?: boolean;
  active?: boolean;
  onToggle: (n: number) => void;
}) {
  const bad = !citation.verified;
  return (
    <button
      type="button"
      onClick={() => onToggle(citation.n)}
      aria-pressed={active}
      data-testid="citation-chip"
      data-verified={citation.verified ? 'true' : 'false'}
      title={bad ? `Unverified citation. ${unverifiedReason(citation)}` : citationLabel(citation)}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${
        bad ? CHIP_BAD : CHIP_OK
      } ${active ? 'ring-2 ring-slate-400' : ''}`}
    >
      {bad && <span aria-hidden="true">⚠</span>}
      <span>{compact ? citation.n : `${citation.n} · ${citationLabel(citation)}`}</span>
      {bad && <span className="sr-only">unverified citation</span>}
    </button>
  );
}
