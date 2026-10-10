/**
 * SHARED CONTRACT (frozen) - changes need both laptops to agree (docs/TEAM.md).
 * Mirrors BRIEF Section 5. camelCase here, snake_case in SQLite. Where the physical tables differ
 * from the brief, docs/CONTRACT_REQUESTS.md ("Schema reconciliation") explains how.
 */

// ---------------------------------------------------------------- vocab

/** What the ingestion pipeline is told a file is. `notes` = handwritten notes. */
export type SourceRole = 'book' | 'slides' | 'notes';

/** Section 5 `documents.kind`. */
export type DocumentKind =
  'book' | 'slides' | 'handwritten' | 'past_paper' | 'syllabus' | 'text_note';
export type DocumentLevel = 'intro' | 'standard' | 'advanced';
export type DocumentStatus = 'processing' | 'ready' | 'failed';

/** Relations stored on an alignment edge. */
export type EdgeRelation = 'covers' | 'extends' | 'conflicts';
/** All five relation types shown in the UI; the last two are flags, not edges. */
export type Relation = EdgeRelation | 'professor_only' | 'book_only';

export type ClaimVerdict = 'yes' | 'partial' | 'no' | 'n/a';
export type ConflictType = 'notation' | 'definition' | 'sign_convention' | 'formula' | 'scope';
export type UserStatus = 'none' | 'confirmed' | 'rejected' | 'remapped';

/** Stored chunk types. The brief also lists `solution`; see CONTRACT_REQUESTS (schema). */
export type ChunkKind = 'text' | 'definition' | 'example' | 'exercise' | 'formula';

export type JobKind = 'ingest' | 'align';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type MatchRoute = 'inherited' | 'direct';
export type ExerciseStatus = 'not_started' | 'attempted' | 'solved' | 'struggled';
export type CitationStatus = 'verified' | 'unverified';
export type VerificationStatus = 'verified' | 'mismatch' | 'error';

// ------------------------------------------------------------- entities

export interface Course {
  id: string;
  name: string;
  createdAt: string;
}

export interface Document {
  id: string;
  courseId: string;
  kind: DocumentKind;
  title: string;
  /** Stored path of the original file (never served back to the client). */
  path: string | null;
  level: DocumentLevel;
  meta: Record<string, unknown>;
  status: DocumentStatus;
  /** Mean page extraction quality 0..1; null until ingestion finishes. */
  extractionQuality: number | null;
  /** sha256 of file bytes; ingestion cache key. */
  contentHash: string;
  pageCount: number;
  /** printed page = pdf page + pageOffset. */
  pageOffset: number;
  createdAt: string;
}

export interface Page {
  id: string;
  documentId: string;
  pdfPage: number;
  /** Null when no printed number could be fitted. */
  printedPage: number | null;
  text: string;
  imagePath: string | null;
  ocrConfidence: number | null;
  isScanned: boolean;
  /** 0 clean .. 1 garbled. */
  garbledScore: number;
  reextracted: boolean;
}

export interface Section {
  id: string;
  documentId: string;
  parentId: string | null;
  title: string;
  level: number;
  pageStart: number;
  pageEnd: number;
  /** Section summary used for coarse retrieval (Section 7). */
  summary: string | null;
}

export interface Chunk {
  id: string;
  documentId: string;
  sectionId: string | null;
  parentId: string | null;
  prevId: string | null;
  nextId: string | null;
  kind: ChunkKind;
  /** Clean display text; quotes are verified against this. */
  text: string;
  /** Book > Chapter > Section [type]; used for embedding and BM25 only. */
  contextHeader: string;
  /** First PDF page (same value as pdfPageStart). */
  page: number;
  pdfPageStart: number;
  pdfPageEnd: number;
  printedPageStart: number | null;
  printedPageEnd: number | null;
  tokenCount: number;
  /** 0 (garbled) .. 1 (clean). */
  quality: number;
}

export interface TranscriptionLine {
  text: string;
  /** 0..1 */
  confidence: number;
  /** Character ranges [start, end) the vision model was unsure about. */
  uncertainSpans: Array<{ start: number; end: number }>;
}

export interface UnitTranscription {
  lines: TranscriptionLine[];
}

/** One slide or one handwritten page/topic. */
export interface LectureUnit {
  id: string;
  documentId: string;
  unitNo: number;
  title: string;
  text: string;
  imagePath: string | null;
  transcription: UnitTranscription | null;
  /** Query built for retrieval (title + body + neighbours). */
  queryText: string | null;
}

export interface Exercise {
  id: string;
  documentId: string;
  chunkId: string | null;
  /** The printed exercise number, e.g. "Exercise 2.3". */
  label: string;
  /** Exercise text. */
  statement: string;
  hasSolution: boolean;
  solution: string | null;
  /** PDF page. */
  page: number;
  printedPage: number | null;
  /** 0 easy .. 1 hard; null until estimated. */
  difficulty: number | null;
  level: DocumentLevel;
  topicTags: string[];
  /** True when a numeric answer can be checked by running code. */
  verifiable: boolean;
}

/** Every signal behind a confidence number, shown in the "Why this match?" popover. */
export interface ConfidenceSignals {
  retrievalScore: number;
  quoteVerified: boolean;
  /** 1 when both judge runs agree, else 0. */
  judgeAgreement: number;
  top1Gap: number;
  extractionQuality: number;
  llmSelfReport: number;
  /** Hard caps that fired, e.g. "quote_not_verified". */
  capsApplied: string[];
}

export interface AlignmentEdge {
  id: string;
  unitId: string;
  chunkId: string;
  relation: EdgeRelation;
  /** Computed by code from `signals`, never taken from the LLM. */
  confidence: number;
  signals: ConfidenceSignals;
  /** Max 2 sentences. */
  rationale: string;
  /** Max 20 words each. */
  evidenceUnit: string;
  evidenceBook: string;
  quoteVerified: boolean;
  claimVerdict: ClaimVerdict;
  conflictType: ConflictType | null;
  userStatus: UserStatus;
  createdAt: string;
}

export interface UnitFlag {
  id: string;
  unitId: string;
  flag: 'professor_only';
}

export interface ChunkFlag {
  id: string;
  chunkId: string;
  flag: 'book_only';
}

export interface ExerciseMatch {
  id: string;
  exerciseId: string;
  unitId: string;
  route: MatchRoute;
  score: number;
  signals: Record<string, number>;
  rationale: string;
  userStatus: UserStatus;
}

export interface ExerciseProgress {
  id: string;
  exerciseId: string;
  status: ExerciseStatus;
  attempts: number;
  lastAttemptAt: string | null;
  notes: string;
}

export interface Concept {
  id: string;
  bookId: string;
  name: string;
  chunkId: string | null;
}

export interface ConceptDep {
  conceptId: string;
  dependsOnId: string;
  confidence: number;
}

export interface Feedback {
  id: string;
  edgeId: string;
  action: 'confirm' | 'reject' | 'remap';
  createdAt: string;
}

export interface Citation {
  documentId: string;
  chunkId: string;
  /** PDF page. Resolved from the database by code; the model never writes it. */
  page: number;
  /** Page printed in the book; what the UI shows. */
  printedPage: number | null;
  /** Max 20 words. */
  quote: string;
  status: CitationStatus;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  /** One-line summary for the UI, e.g. "Looked up pages 41-48". */
  summary: string;
}

export interface ChatSession {
  id: string;
  courseId: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallRecord[];
  citations: Citation[];
  /** True when a number in the answer did not come from run_verification. */
  unverifiedCalculation: boolean;
  /** Computed, 0..1; null for user messages and abstentions. */
  confidence: number | null;
  createdAt: string;
}

export interface Verification {
  id: string;
  exerciseId: string | null;
  script: string;
  status: VerificationStatus;
  expected: string;
  got: string;
  createdAt: string;
}

export interface UsageLogEntry {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  createdAt: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface JobProgress {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message: string;
}

// ------------------------------------------------------------- coverage

/** Section 9.4. Coverage measures how much a book was touched by lectures, not importance. */
export interface ChapterCoverage {
  documentId: string;
  chapter: string;
  totalPages: number;
  matchedPages: number;
  /** matchedPages / totalPages, 0..1. */
  coverage: number;
  /** Sections of this chapter with no counted edge. */
  bookOnlySections: number;
  /** Chunks of this chapter flagged book_only. */
  bookOnlyChunks: number;
  conflicts: number;
  lowConfidenceEdges: number;
}

/** Professor-only units belong to no chapter, so course-wide counts live here. */
export interface CoverageTotals {
  units: number;
  unitsWithEdges: number;
  professorOnlyUnits: number;
  bookOnlyChunks: number;
  conflicts: number;
  lowConfidenceEdges: number;
}

export interface ReadingPathItem {
  unitId: string;
  /** Smallest page set, most confident first. */
  pages: Array<{ documentId: string; printedPageStart: number; printedPageEnd: number }>;
}

export interface CoverageReport {
  courseId: string;
  /** EDGE_MIN_CONFIDENCE used for this report. */
  edgeMinConfidence: number;
  chapters: ChapterCoverage[];
  totals: CoverageTotals;
  readingPaths: ReadingPathItem[];
}
