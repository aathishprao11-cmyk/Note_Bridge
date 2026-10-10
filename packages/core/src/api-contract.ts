import { z } from 'zod';
import type {
  AlignmentEdge,
  ChapterCoverage,
  ConfidenceSignals,
  Course,
  CoverageReport,
  Citation,
  CoverageTotals,
  Document,
  Exercise,
  JobProgress,
  LectureUnit,
  Page,
  ReadingPathItem,
} from './types';

/**
 * SHARED CONTRACT (frozen): zod request/response schemas for every route in BRIEF Section 14.
 * Laptop B builds the web app against these; Laptop A's routes validate against them.
 * Entity schemas are annotated with z.ZodType<T> against types.ts, so the two cannot drift.
 * Errors are always { error: { code, message } }. Dates are ISO-like strings.
 */

// ------------------------------------------------------------ vocabulary

const score = z.number().min(0).max(1);
const id = z.string().min(1);

export const DocumentKindSchema = z.enum([
  'book',
  'slides',
  'handwritten',
  'past_paper',
  'syllabus',
  'text_note',
]);
export const DocumentLevelSchema = z.enum(['intro', 'standard', 'advanced']);
export const EdgeRelationSchema = z.enum(['covers', 'extends', 'conflicts']);
/** The five relation types the UI shows; professor_only and book_only are flags. */
export const RelationSchema = z.enum([
  'covers',
  'extends',
  'conflicts',
  'professor_only',
  'book_only',
]);
export const ClaimVerdictSchema = z.enum(['yes', 'partial', 'no', 'n/a']);
export const ConflictTypeSchema = z.enum([
  'notation',
  'definition',
  'sign_convention',
  'formula',
  'scope',
]);
export const UserStatusSchema = z.enum(['none', 'confirmed', 'rejected', 'remapped']);
export const ChunkKindSchema = z.enum(['text', 'definition', 'example', 'exercise', 'formula']);

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ErrorSchema>;

// -------------------------------------------------------------- entities

export const CourseSchema: z.ZodType<Course> = z.object({
  id,
  name: z.string(),
  createdAt: z.string(),
});

export const DocumentSchema: z.ZodType<Document> = z.object({
  id,
  courseId: id,
  kind: DocumentKindSchema,
  title: z.string(),
  path: z.string().nullable(),
  level: DocumentLevelSchema,
  meta: z.record(z.string(), z.unknown()),
  status: z.enum(['processing', 'ready', 'failed']),
  extractionQuality: score.nullable(),
  contentHash: z.string(),
  pageCount: z.number().int().min(0),
  pageOffset: z.number().int(),
  createdAt: z.string(),
});

export const PageSchema: z.ZodType<Page> = z.object({
  id,
  documentId: id,
  pdfPage: z.number().int().min(1),
  printedPage: z.number().int().nullable(),
  text: z.string(),
  imagePath: z.string().nullable(),
  ocrConfidence: score.nullable(),
  isScanned: z.boolean(),
  garbledScore: score,
  reextracted: z.boolean(),
});

export const ConfidenceSignalsSchema: z.ZodType<ConfidenceSignals> = z.object({
  retrievalScore: score,
  quoteVerified: z.boolean(),
  judgeAgreement: score,
  top1Gap: score,
  extractionQuality: score,
  llmSelfReport: score,
  capsApplied: z.array(z.string()),
});

export const AlignmentEdgeSchema: z.ZodType<AlignmentEdge> = z.object({
  id,
  unitId: id,
  chunkId: id,
  relation: EdgeRelationSchema,
  confidence: score,
  signals: ConfidenceSignalsSchema,
  rationale: z.string(),
  evidenceUnit: z.string(),
  evidenceBook: z.string(),
  quoteVerified: z.boolean(),
  claimVerdict: ClaimVerdictSchema,
  conflictType: ConflictTypeSchema.nullable(),
  userStatus: UserStatusSchema,
  createdAt: z.string(),
});

export const LectureUnitSchema: z.ZodType<LectureUnit> = z.object({
  id,
  documentId: id,
  unitNo: z.number().int().min(1),
  title: z.string(),
  text: z.string(),
  imagePath: z.string().nullable(),
  transcription: z
    .object({
      lines: z.array(
        z.object({
          text: z.string(),
          confidence: score,
          uncertainSpans: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
        }),
      ),
    })
    .nullable(),
  queryText: z.string().nullable(),
});

export const ExerciseSchema: z.ZodType<Exercise> = z.object({
  id,
  documentId: id,
  chunkId: z.string().nullable(),
  label: z.string(),
  statement: z.string(),
  hasSolution: z.boolean(),
  solution: z.string().nullable(),
  page: z.number().int(),
  printedPage: z.number().int().nullable(),
  difficulty: score.nullable(),
  level: DocumentLevelSchema,
  topicTags: z.array(z.string()),
  verifiable: z.boolean(),
});

export const CitationSchema: z.ZodType<Citation> = z.object({
  documentId: id,
  chunkId: id,
  page: z.number().int(),
  printedPage: z.number().int().nullable(),
  quote: z.string(),
  status: z.enum(['verified', 'unverified']),
});

export const JobProgressSchema: z.ZodType<JobProgress> = z.object({
  jobId: id,
  kind: z.enum(['ingest', 'align']),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  progress: score,
  message: z.string(),
});

export const JobRecordSchema = z.object({
  jobId: id,
  kind: z.enum(['ingest', 'align']),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  progress: score,
  message: z.string(),
  documentId: z.string().nullable(),
  error: z.string().nullable(),
});

// -------------------------------------------------------------- coverage

export const ChapterCoverageSchema: z.ZodType<ChapterCoverage> = z.object({
  documentId: id,
  chapter: z.string(),
  totalPages: z.number().int().min(0),
  matchedPages: z.number().int().min(0),
  coverage: score,
  bookOnlySections: z.number().int().min(0),
  bookOnlyChunks: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  lowConfidenceEdges: z.number().int().min(0),
});

const CoverageTotalsSchema: z.ZodType<CoverageTotals> = z.object({
  units: z.number().int().min(0),
  unitsWithEdges: z.number().int().min(0),
  professorOnlyUnits: z.number().int().min(0),
  bookOnlyChunks: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  lowConfidenceEdges: z.number().int().min(0),
});

const ReadingPathItemSchema: z.ZodType<ReadingPathItem> = z.object({
  unitId: id,
  pages: z.array(
    z.object({
      documentId: id,
      printedPageStart: z.number().int(),
      printedPageEnd: z.number().int(),
    }),
  ),
});

export const CoverageReportSchema: z.ZodType<CoverageReport> = z.object({
  courseId: id,
  edgeMinConfidence: score,
  chapters: z.array(ChapterCoverageSchema),
  totals: CoverageTotalsSchema,
  readingPaths: z.array(ReadingPathItemSchema),
});

// ---------------------------------------------------------------- routes
// Each route below: params / query / body (request) and a response schema.

/** POST /api/courses */
export const CreateCourseBody = z.object({ name: z.string().trim().min(1).max(120) });
export const CourseResponse = CourseSchema;
/** GET /api/courses */
export const ListCoursesResponse = z.array(CourseSchema);

export const CourseParams = z.object({ id });

/** POST /api/courses/:id/documents (multipart). Manual notes are split at ---PAGE---. */
export const UploadFields = z
  .object({
    kind: DocumentKindSchema,
    title: z.string().trim().max(200).optional(),
    level: DocumentLevelSchema.optional(),
    transcript: z.string().trim().min(1).max(50_000).optional(),
  })
  .refine((fields) => fields.transcript === undefined || fields.kind === 'handwritten', {
    message: 'A manual transcript is only supported for handwritten notes.',
    path: ['transcript'],
  });
export const UploadResponse = z.object({
  documentId: id,
  jobId: id,
  /** True when these exact bytes were already ingested into this course. */
  cached: z.boolean(),
});
/** GET /api/courses/:id/documents */
export const ListDocumentsResponse = z.array(DocumentSchema);

/** GET /api/jobs/:id */
export const JobParams = z.object({ id });
export const JobResponse = JobRecordSchema;
/** GET /api/jobs/:id/events: SSE, each `data:` line is one JobProgress. */
export const JobEvent = JobProgressSchema;

/** POST /api/courses/:id/align */
export const AlignBody = z
  .object({
    /** Limit to these lecture documents; default is every slides/handwritten document. */
    documentIds: z.array(id).optional(),
  })
  .default({});
export const AlignResponse = z.object({ jobId: id });

/** A book passage an edge points at, resolved from the database (never written by the model). */
export const ChunkRefSchema = z.object({
  id,
  documentId: id,
  documentTitle: z.string(),
  chapter: z.string().nullable(),
  section: z.string().nullable(),
  kind: ChunkKindSchema,
  /** Clean display text, capped for list views (max 20 words are quotable). */
  snippet: z.string(),
  pdfPageStart: z.number().int(),
  pdfPageEnd: z.number().int(),
  printedPageStart: z.number().int().nullable(),
  printedPageEnd: z.number().int().nullable(),
  /** Source page extraction quality 0..1. */
  quality: score,
  bookOnly: z.boolean(),
});
export type ChunkRef = z.infer<typeof ChunkRefSchema>;

export const UnitViewSchema = z.object({
  unit: LectureUnitSchema,
  documentTitle: z.string(),
  documentKind: DocumentKindSchema,
  professorOnly: z.boolean(),
});

/** GET /api/courses/:id/alignment?relation=&minConfidence=&maxConfidence=&userStatus=&flag=&documentId= */
export const AlignmentQuery = z.object({
  relation: RelationSchema.optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  userStatus: UserStatusSchema.optional(),
  flag: z.enum(['professor_only', 'book_only']).optional(),
  documentId: id.optional(),
});
export const AlignmentResponse = z.object({
  courseId: id,
  units: z.array(UnitViewSchema),
  edges: z.array(AlignmentEdgeSchema),
  /** Every chunk referenced by `edges`, plus book_only chunks, keyed by chunk id. */
  chunks: z.record(z.string(), ChunkRefSchema),
  /** Counts for the filter bar: edge relations plus the two flags. */
  counts: z.object({
    covers: z.number().int(),
    extends: z.number().int(),
    conflicts: z.number().int(),
    professor_only: z.number().int(),
    book_only: z.number().int(),
  }),
});

/** PATCH /api/edges/:id. `remap` needs the chunk the student says is the right match. */
export const EdgeParams = z.object({ id });
export const PatchEdgeBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('remap'), chunkId: id }),
]);
export const PatchEdgeResponse = AlignmentEdgeSchema;

/** GET /api/edges/:id/signals ("Why this match?") */
export const EdgeSignalsResponse = z.object({
  edgeId: id,
  confidence: score,
  signals: ConfidenceSignalsSchema,
  /** Weights used, from config, so the popover can show how the number was built. */
  weights: z.object({
    retrieval: z.number(),
    quote: z.number(),
    judgeAgreement: z.number(),
    top1Gap: z.number(),
    extractionQuality: z.number(),
    llmSelfReport: z.number(),
  }),
  rationale: z.string(),
  evidenceUnit: z.string(),
  evidenceBook: z.string(),
});

/** GET /api/courses/:id/coverage */
export const CoverageResponse = CoverageReportSchema;

/** GET /api/units/:id */
export const UnitParams = z.object({ id });
export const UnitDetailResponse = z.object({
  unit: LectureUnitSchema,
  documentTitle: z.string(),
  professorOnly: z.boolean(),
  edges: z.array(AlignmentEdgeSchema),
  chunks: z.record(z.string(), ChunkRefSchema),
  prevUnitId: z.string().nullable(),
  nextUnitId: z.string().nullable(),
});

/** GET /api/documents/:id/pages/:n  (n = PDF page, 1-based) */
export const PageParams = z.object({ id, n: z.coerce.number().int().min(1) });
export const PageResponse = z.object({
  page: PageSchema,
  documentTitle: z.string(),
  pageCount: z.number().int(),
  /** Chunks on this page, so the viewer can highlight cited evidence. */
  chunks: z.array(ChunkRefSchema),
});

/** GET /api/documents/:id/quality */
export const QualityParams = z.object({ id });
export const QualityResponse = z.object({
  documentId: id,
  extractionQuality: score.nullable(),
  pageOffset: z.number().int(),
  offsetConfidence: score,
  warnings: z.array(z.string()),
  pages: z.array(
    z.object({
      pdfPage: z.number().int(),
      printedPage: z.number().int().nullable(),
      score,
      garbledScore: score,
      verdict: z.enum(['ok', 'vision', 'reject']),
      isScanned: z.boolean(),
      reextracted: z.boolean(),
      reasons: z.array(z.string()),
    }),
  ),
});

/** POST /api/courses/:id/chat: request body, then an SSE stream of ChatEvent. */
export const ChatBody = z.object({
  message: z.string().trim().min(1).max(4000),
  sessionId: id.optional(),
});
export const ToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  /** One-line summary for the UI, e.g. "Looked up pages 41-48". */
  summary: z.string(),
});
export const ChatEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: id }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('tool-started'), call: ToolCallSchema }),
  z.object({ type: z.literal('tool-finished'), call: ToolCallSchema, ok: z.boolean() }),
  z.object({
    type: z.literal('usage'),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  }),
  z.object({
    type: z.literal('done'),
    messageId: id,
    content: z.string(),
    citations: z.array(CitationSchema),
    unverifiedCalculation: z.boolean(),
    abstained: z.boolean(),
    /** Computed, never the model's own number; null when abstained. */
    confidence: score.nullable(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatEventPayload = z.infer<typeof ChatEvent>;

/** GET /api/courses/:id/chat/examples: canned conversations for demo mode and the MockAgent. */
export const ChatExampleSchema = z.object({
  id,
  title: z.string(),
  question: z.string(),
  events: z.array(ChatEvent),
});
export const ChatExamplesResponse = z.array(ChatExampleSchema);

/** /api/features/<plugin-id>/... is owned by each plugin; only the prefix is contract. */
export const FEATURE_ROUTE_PREFIX = '/api/features';

// ------------------------------------------------------------ route table

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  /** What the route returns; for SSE routes this is the per-event schema. */
  response: z.ZodType;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  sse?: boolean;
  multipart?: boolean;
}

const route = (spec: RouteSpec): RouteSpec => spec;

/** One entry per Section 14 route (plus the Phase 1a job status helper). Used by tests and docs. */
export const ROUTES = {
  createCourse: route({
    method: 'POST',
    path: '/api/courses',
    body: CreateCourseBody,
    response: CourseResponse,
  }),
  listCourses: route({ method: 'GET', path: '/api/courses', response: ListCoursesResponse }),
  getCourse: route({
    method: 'GET',
    path: '/api/courses/:id',
    params: CourseParams,
    response: CourseResponse,
  }),
  uploadDocument: route({
    method: 'POST',
    path: '/api/courses/:id/documents',
    params: CourseParams,
    body: UploadFields,
    multipart: true,
    response: UploadResponse,
  }),
  listDocuments: route({
    method: 'GET',
    path: '/api/courses/:id/documents',
    params: CourseParams,
    response: ListDocumentsResponse,
  }),
  getJob: route({ method: 'GET', path: '/api/jobs/:id', params: JobParams, response: JobResponse }),
  jobEvents: route({
    method: 'GET',
    path: '/api/jobs/:id/events',
    params: JobParams,
    response: JobEvent,
    sse: true,
  }),
  align: route({
    method: 'POST',
    path: '/api/courses/:id/align',
    params: CourseParams,
    body: AlignBody,
    response: AlignResponse,
  }),
  alignment: route({
    method: 'GET',
    path: '/api/courses/:id/alignment',
    params: CourseParams,
    query: AlignmentQuery,
    response: AlignmentResponse,
  }),
  patchEdge: route({
    method: 'PATCH',
    path: '/api/edges/:id',
    params: EdgeParams,
    body: PatchEdgeBody,
    response: PatchEdgeResponse,
  }),
  edgeSignals: route({
    method: 'GET',
    path: '/api/edges/:id/signals',
    params: EdgeParams,
    response: EdgeSignalsResponse,
  }),
  coverage: route({
    method: 'GET',
    path: '/api/courses/:id/coverage',
    params: CourseParams,
    response: CoverageResponse,
  }),
  getUnit: route({
    method: 'GET',
    path: '/api/units/:id',
    params: UnitParams,
    response: UnitDetailResponse,
  }),
  getPage: route({
    method: 'GET',
    path: '/api/documents/:id/pages/:n',
    params: PageParams,
    response: PageResponse,
  }),
  quality: route({
    method: 'GET',
    path: '/api/documents/:id/quality',
    params: QualityParams,
    response: QualityResponse,
  }),
  chat: route({
    method: 'POST',
    path: '/api/courses/:id/chat',
    params: CourseParams,
    body: ChatBody,
    response: ChatEvent,
    sse: true,
  }),
  chatExamples: route({
    method: 'GET',
    path: '/api/courses/:id/chat/examples',
    params: CourseParams,
    response: ChatExamplesResponse,
  }),
} satisfies Record<string, RouteSpec>;
