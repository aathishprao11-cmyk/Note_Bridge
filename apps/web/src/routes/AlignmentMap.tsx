import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  listDocuments,
  listEdges,
  listSections,
  startAlign,
  subscribeJobProgress,
  updateEdge,
} from '../lib/api';
import type { Document, Edge, EdgeStatus, JobProgress, Section } from '../lib/types';
import { ErrorBanner, Loading, ProgressBar, RelationBadge } from '../components/ui';

/** Alignment Map: run alignment, then confirm / reject / remap each proposed edge. */
export function AlignmentMap() {
  const { courseId = '' } = useParams();
  const [edges, setEdges] = useState<Edge[] | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [e, s, d] = await Promise.all([
        listEdges(courseId),
        listSections(courseId),
        listDocuments(courseId),
      ]);
      setEdges(e);
      setSections(s);
      setDocuments(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, [courseId]);

  const sectionTitle = (id: string | null): string =>
    (id ? sections.find((s) => s.id === id)?.title : undefined) ?? '—';

  // Remap targets are book-document sections only (role lives on the Document, not the Section).
  const bookDocIds = new Set(documents.filter((d) => d.kind === 'book').map((d) => d.id));
  const bookOptions = sections.filter((s) => bookDocIds.has(s.documentId));

  async function onStartAlign() {
    setRunning(true);
    setError(null);
    try {
      const { jobId } = await startAlign(courseId);
      const unsub = subscribeJobProgress(jobId, 'align', {
        onProgress: setProgress,
        onError: (err) => setError(err.message),
        onDone: () => {
          unsub();
          setRunning(false);
          void refresh();
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  async function onDecide(edge: Edge, status: EdgeStatus, bookSectionId?: string) {
    setError(null);
    try {
      await updateEdge(edge.id, { status, ...(bookSectionId ? { bookSectionId } : {}) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onRemap(edge: Edge, newSectionId: string) {
    if (!newSectionId) return;
    void onDecide(edge, 'remapped', newSectionId);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Alignment map</h2>
        <button
          type="button"
          onClick={onStartAlign}
          disabled={running}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {running ? 'Aligning…' : 'Run alignment'}
        </button>
      </div>

      {running && progress && (
        <div className="space-y-1">
          <ProgressBar value={progress.progress} />
          <p className="text-xs text-slate-500">
            {progress.status}: {progress.message ?? ''}
          </p>
        </div>
      )}

      {error && <ErrorBanner message={error} />}
      {!edges && !error && <Loading />}
      {edges?.length === 0 && (
        <p className="text-sm text-slate-500">No edges yet. Click “Run alignment”.</p>
      )}

      <ul className="space-y-3">
        {edges?.map((edge) => (
          <li key={edge.id} className="rounded border border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm">
                <strong>{sectionTitle(edge.profUnitId)}</strong>
                <span className="text-slate-400"> ↔ </span>
                {edge.bookSectionId ? sectionTitle(edge.bookSectionId) : <em>none</em>}
              </span>
              <div className="flex items-center gap-2">
                <RelationBadge relation={edge.relation} />
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{edge.status}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onDecide(edge, 'confirmed')}
                disabled={!edge.bookSectionId}
                className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => onDecide(edge, 'rejected')}
                className="rounded bg-red-600 px-3 py-1 text-xs text-white"
              >
                Reject
              </button>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Remap:
                <select
                  className="rounded border border-slate-300 px-2 py-1"
                  value=""
                  onChange={(e) => onRemap(edge, e.target.value)}
                >
                  <option value="">Choose section…</option>
                  {bookOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
