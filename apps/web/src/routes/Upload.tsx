import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listDocuments, subscribeJobProgress, uploadDocument } from '../lib/api';
import type { Document, DocumentKind, JobProgress } from '../lib/types';
import { ProgressBar, ErrorBanner, Loading, EmptyState } from '../components/ui';

const ROLES: { value: DocumentKind; label: string; accept: string; needsTranscript?: boolean }[] = [
  { value: 'book', label: 'Book (PDF)', accept: 'application/pdf' },
  { value: 'slides', label: 'Slides (PDF)', accept: 'application/pdf' },
  {
    value: 'handwritten',
    label: 'Handwritten notes (PDF or image)',
    accept: 'application/pdf,image/png,image/jpeg',
    needsTranscript: true,
  },
];

const ROLE_LABEL: Record<DocumentKind, string> = {
  book: 'Book',
  slides: 'Slides',
  handwritten: 'Handwritten notes',
  past_paper: 'Past paper',
  syllabus: 'Syllabus',
  text_note: 'Text note',
};

/**
 * Documents screen: list docs, upload a new source with live ingest progress.
 * Handwritten notes are read offline from a transcript you type (no OCR/vision provider runs);
 * separate physical pages with ---PAGE--- on its own line.
 */
export function Upload() {
  const { courseId = '' } = useParams();
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<DocumentKind>('slides');
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  const roleSpec = ROLES.find((r) => r.value === role) ?? ROLES[1]!;

  async function refresh() {
    setError(null);
    try {
      setDocuments(await listDocuments(courseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, [courseId]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || uploading) return;
    if (roleSpec.needsTranscript && !transcript.trim()) {
      setError('Type what your notes say before uploading (handwriting recognition is offline).');
      return;
    }
    setUploading(true);
    setError(null);
    setProgress({ jobId: '', kind: 'ingest', status: 'queued', progress: 0, message: 'Uploading' });
    try {
      const result = await uploadDocument(
        courseId,
        file,
        role,
        roleSpec.needsTranscript ? transcript : undefined,
      );
      const unsub = subscribeJobProgress(result.jobId, 'ingest', {
        onProgress: (p) => {
          setProgress(p);
          // Terminal frames are the answer; the stream closes right after them. Treating a
          // normal 'failed' ingest as a disconnect used to hide the real error message.
          if (p.status === 'done') {
            unsub();
            setUploading(false);
            void refresh();
          } else if (p.status === 'failed') {
            unsub();
            setError(p.message || 'Ingestion failed.');
            setUploading(false);
            void refresh();
          }
        },
        onError: (err) => {
          setError(err.message);
          setUploading(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 p-4">
        <h2 className="mb-3 font-semibold">Upload a source</h2>
        <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Role</span>
            <select
              className="rounded border border-slate-300 px-3 py-2"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as DocumentKind);
                setFile(null);
                setTranscript('');
              }}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">
              {roleSpec.needsTranscript ? 'File (PDF, PNG or JPEG)' : 'PDF file'}
            </span>
            <input
              key={role}
              type="file"
              accept={roleSpec.accept}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={!file || uploading}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>

        {roleSpec.needsTranscript && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-slate-600">
              Transcript (type what the notes say; no handwriting OCR runs offline)
            </span>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              maxLength={50_000}
              placeholder={
                'Page 1 text…\n\n---PAGE---\n\nPage 2 text… (only when the file has more pages)'
              }
              className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-slate-500">
              One block per file page; put ---PAGE--- on its own line between pages. The server
              checks the page count before indexing.
            </span>
          </label>
        )}

        {uploading && progress && (
          <div className="mt-4 space-y-1">
            <ProgressBar value={progress.progress} />
            <p className="text-xs text-slate-500">
              {progress.status}: {progress.message ?? ''}
            </p>
          </div>
        )}
      </section>

      {error && <ErrorBanner message={error} />}

      <section>
        <h2 className="mb-3 font-semibold">Documents</h2>
        {!documents && !error && <Loading />}
        {documents?.length === 0 && <EmptyState>No documents yet.</EmptyState>}
        <ul className="divide-y divide-slate-200 rounded border border-slate-200">
          {documents?.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-3">
              <div>
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-slate-500">
                  {ROLE_LABEL[d.kind]} · {d.pageCount} pages
                </p>
              </div>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{ROLE_LABEL[d.kind]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
