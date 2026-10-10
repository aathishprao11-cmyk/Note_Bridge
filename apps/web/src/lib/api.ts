/**
 * Typed client for the Phase 1b REST + SSE API (docs/API.md). Types come from `@gyan/core`.
 *
 * Endpoints are still Dev A's Phase 1b work, so each call falls back to contract-shaped fixtures
 * when `VITE_USE_MOCK_API` is not `false` (the default). Set `VITE_USE_MOCK_API=false` in `.env`
 * once the real server is up — no code change needed. See docs/API.md and docs/CONTRACT_REQUESTS.md.
 */
import type {
  Course,
  Document,
  Section,
  Edge,
  EdgeStatus,
  DocumentKind,
  Relation,
  JobProgress,
  Coverage,
} from './types';
import {
  mockCourse,
  mockCourses,
  mockDocuments,
  mockSections,
  mockEdges,
  mockJobProgress,
} from './mockData';
import { computeCoverage } from './format';

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false';

export interface Health {
  ok: boolean;
  llmProvider: string;
  embeddingsProvider: string;
  plugins: string[];
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return (await res.json()) as Health;
}

/** Matches the error shape in docs/API.md: { error: { code, message } }. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return new ApiError(status, err?.code ?? 'http_error', err?.message ?? `HTTP ${status}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw toApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export async function listCourses(): Promise<Course[]> {
  if (useMock) return mockCourses;
  return request<Course[]>('/api/courses');
}

export async function createCourse(name: string): Promise<Course> {
  if (useMock) {
    return { ...mockCourse, id: `course-${Date.now()}`, name, createdAt: new Date().toISOString() };
  }
  return request<Course>('/api/courses', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function listDocuments(courseId: string): Promise<Document[]> {
  if (useMock) return mockDocuments.filter((d) => d.courseId === courseId);
  return request<Document[]>(`/api/courses/${encodeURIComponent(courseId)}/documents`);
}

export interface UploadResult {
  document: Document;
  jobId: string;
}

export async function uploadDocument(
  courseId: string,
  file: File,
  kind: DocumentKind,
): Promise<UploadResult> {
  if (useMock) {
    return {
      document: {
        id: `doc-${Date.now()}`,
        courseId,
        kind,
        title: file.name,
        path: null,
        level: 'standard',
        meta: {},
        status: 'processing',
        extractionQuality: null,
        contentHash: 'pending',
        pageCount: 0,
        pageOffset: 0,
        createdAt: new Date().toISOString(),
      },
      jobId: `job-${Date.now()}`,
    };
  }
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  // No JSON content-type: the browser sets multipart boundaries.
  const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/documents`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw toApiError(res.status, body);
  }
  // The contract answers { documentId, jobId, cached }; the screens want the document itself.
  const started = (await res.json()) as { documentId: string; jobId: string };
  const document = (await listDocuments(courseId)).find((d) => d.id === started.documentId);
  if (!document) throw new ApiError(500, 'http_error', 'Uploaded document was not found');
  return { document, jobId: started.jobId };
}

/**
 * There is no /sections route in the contract (Section 14). Units and the book passages the
 * alignment refers to come from GET /api/courses/:id/alignment and are shaped as Sections.
 */
export async function listSections(courseId: string): Promise<Section[]> {
  if (useMock) {
    const docIds = new Set(mockDocuments.filter((d) => d.courseId === courseId).map((d) => d.id));
    return mockSections.filter((s) => docIds.has(s.documentId));
  }
  const a = await getAlignment(courseId);
  const units = a.units.map(({ unit }): Section => ({
    id: unit.id,
    documentId: unit.documentId,
    parentId: null,
    title: unit.title,
    level: 1,
    pageStart: unit.unitNo,
    pageEnd: unit.unitNo,
    summary: null,
  }));
  const passages = Object.values(a.chunks).map((c): Section => ({
    id: c.id,
    documentId: c.documentId,
    parentId: null,
    title: `${c.section ?? c.chapter ?? 'Passage'} (p.${c.printedPageStart ?? c.pdfPageStart})`,
    level: 2,
    pageStart: c.pdfPageStart,
    pageEnd: c.pdfPageEnd,
    summary: null,
  }));
  return [...units, ...passages];
}

export async function startAlign(courseId: string): Promise<{ jobId: string }> {
  if (useMock) return { jobId: `job-align-${Date.now()}` };
  return request<{ jobId: string }>(`/api/courses/${encodeURIComponent(courseId)}/align`, {
    method: 'POST',
  });
}

/** The slice of GET /api/courses/:id/alignment (api-contract.ts AlignmentResponse) used here. */
interface AlignmentEdgeView {
  id: string;
  unitId: string;
  chunkId: string;
  relation: Relation;
  confidence: number;
  rationale: string;
  userStatus: 'none' | 'confirmed' | 'rejected' | 'remapped';
}
interface AlignmentView {
  units: Array<{ unit: { id: string; documentId: string; unitNo: number; title: string } }>;
  edges: AlignmentEdgeView[];
  chunks: Record<
    string,
    {
      id: string;
      documentId: string;
      chapter: string | null;
      section: string | null;
      pdfPageStart: number;
      pdfPageEnd: number;
      printedPageStart: number | null;
    }
  >;
}

function getAlignment(courseId: string): Promise<AlignmentView> {
  return request<AlignmentView>(`/api/courses/${encodeURIComponent(courseId)}/alignment`);
}

function toEdge(courseId: string, e: AlignmentEdgeView): Edge {
  return {
    id: e.id,
    courseId,
    profUnitId: e.unitId,
    bookSectionId: e.chunkId,
    relation: e.relation,
    confidence: e.confidence,
    rationale: e.rationale,
    status: e.userStatus === 'none' ? 'proposed' : e.userStatus,
  };
}

/** GET /api/courses/:id/alignment, converted to the edge view model the screens use. */
export async function listEdges(courseId: string): Promise<Edge[]> {
  if (useMock) return mockEdges.filter((e) => e.courseId === courseId);
  return (await getAlignment(courseId)).edges.map((e) => toEdge(courseId, e));
}

export interface UpdateEdgeBody {
  status: EdgeStatus;
  bookSectionId?: string;
}

/** PATCH /api/edges/:id with { action: confirm | reject | remap (+ chunkId) }. */
export async function updateEdge(edgeId: string, body: UpdateEdgeBody): Promise<Edge> {
  if (useMock) {
    const edge = mockEdges.find((e) => e.id === edgeId);
    if (!edge) throw new ApiError(404, 'not_found', `Edge ${edgeId} not found`);
    return { ...edge, ...body };
  }
  const payload =
    body.status === 'confirmed'
      ? { action: 'confirm' }
      : body.status === 'rejected'
        ? { action: 'reject' }
        : body.status === 'remapped' && body.bookSectionId
          ? { action: 'remap', chunkId: body.bookSectionId }
          : null;
  if (!payload) throw new ApiError(400, 'bad_request', 'Only confirm, reject or remap can be sent');
  const updated = await request<AlignmentEdgeView>(`/api/edges/${encodeURIComponent(edgeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return toEdge('', updated);
}

/**
 * Coverage. The `/coverage` response is "TBD in Phase 1b" (docs/API.md), so the client derives it
 * from edges+sections+documents until the contract lands (see docs/CONTRACT_REQUESTS.md).
 */
export async function getCoverage(courseId: string): Promise<Coverage> {
  const [edges, sections, documents] = await Promise.all([
    listEdges(courseId),
    listSections(courseId),
    listDocuments(courseId),
  ]);
  return computeCoverage(courseId, edges, sections, documents);
}

export interface JobProgressHandlers {
  onProgress: (p: JobProgress) => void;
  onError?: (e: Error) => void;
  onDone?: () => void;
}

/**
 * Subscribe to the SSE progress stream (docs/API.md: GET /api/jobs/:id/events). In mock mode it
 * replays a deterministic progress sequence. Returns an unsubscribe function.
 */
export function subscribeJobProgress(
  jobId: string,
  kind: 'ingest' | 'align',
  handlers: JobProgressHandlers,
): () => void {
  if (useMock) {
    const frames = mockJobProgress(jobId, kind);
    const timers: ReturnType<typeof setTimeout>[] = [];
    frames.forEach((frame, i) => {
      timers.push(
        setTimeout(
          () => {
            handlers.onProgress(frame);
            if (i === frames.length - 1) handlers.onDone?.();
          },
          250 * (i + 1),
        ),
      );
    });
    return () => timers.forEach(clearTimeout);
  }

  const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      handlers.onProgress(JSON.parse(event.data) as JobProgress);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };
  source.onerror = () => {
    handlers.onError?.(new ApiError(0, 'sse_error', 'Progress stream disconnected'));
    source.close();
    handlers.onDone?.();
  };
  return () => source.close();
}
