import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listDocuments, subscribeJobProgress, uploadDocument, type UploadResult } from '../lib/api';
import type { Document, DocumentKind, JobProgress } from '../lib/types';
import { ProgressBar, ErrorBanner, Loading, EmptyState } from '../components/ui';

const ROLES: { value: DocumentKind; label: string }[] = [
  { value: 'book', label: 'Book (PDF)' },
  { value: 'slides', label: 'Slides (PDF)' },
  { value: 'handwritten', label: 'Handwritten notes (PDF or image)' },
];

const ROLE_LABEL: Record<DocumentKind, string> = {
  book: 'Book',
  slides: 'Slides',
  handwritten: 'Handwritten notes',
  past_paper: 'Past paper',
  syllabus: 'Syllabus',
  text_note: 'Text note',
};

/** Documents screen: list docs, upload a new source (role + file) with live ingest progress. */
export function Upload() {
  const { courseId = '' } = useParams();
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<DocumentKind>('slides');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);

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
    setUploading(true);
    setError(null);
    setProgress({ jobId: '', kind: 'ingest', status: 'queued', progress: 0, message: 'Uploading' });
    try {
      const result: UploadResult = await uploadDocument(courseId, file, role);
      const unsub = subscribeJobProgress(result.jobId, 'ingest', {
        onProgress: setProgress,
        onError: (err) => setError(err.message),
        onDone: () => {
          unsub();
          setUploading(false);
          void refresh();
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
              onChange={(e) => setRole(e.target.value as DocumentKind)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">PDF file</span>
            <input
              type="file"
              accept="application/pdf"
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
