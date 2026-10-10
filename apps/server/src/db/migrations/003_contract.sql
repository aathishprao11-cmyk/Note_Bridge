-- 003_contract: reconciles the schema with BRIEF Section 5 (contract freeze, Laptop A).
-- Additive only: 001 and 002 are never edited. Where the brief and the existing tables disagree,
-- see docs/CONTRACT_REQUESTS.md ("Schema reconciliation").

-- ---------------------------------------------------------------- documents
-- Brief: documents(kind, path, level, meta_json, status, extraction_quality). The legacy `role`
-- column (book|slides|notes, NOT NULL, CHECK) stays: SQLite cannot relax a CHECK without a table
-- rebuild. `kind` is the source of truth; `role` is the ingestion pipeline's view of it.
ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'book'
  CHECK (kind IN ('book', 'slides', 'handwritten', 'past_paper', 'syllabus', 'text_note'));
ALTER TABLE documents ADD COLUMN path TEXT;
ALTER TABLE documents ADD COLUMN level TEXT NOT NULL DEFAULT 'standard'
  CHECK (level IN ('intro', 'standard', 'advanced'));
ALTER TABLE documents ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE documents ADD COLUMN extraction_quality REAL;
UPDATE documents SET kind = CASE role WHEN 'notes' THEN 'handwritten' ELSE role END;
UPDATE documents SET extraction_quality = (
  SELECT AVG(json_extract(j.value, '$.score')) FROM json_each(documents.page_quality) j
) WHERE page_quality <> '[]';
CREATE INDEX idx_documents_course_kind ON documents(course_id, kind);

-- --------------------------------------------------------------------- pages
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  pdf_page INTEGER NOT NULL,
  printed_page INTEGER,
  text TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  ocr_confidence REAL,
  is_scanned INTEGER NOT NULL DEFAULT 0,
  garbled_score REAL NOT NULL DEFAULT 0,
  reextracted INTEGER NOT NULL DEFAULT 0,
  UNIQUE (document_id, pdf_page)
);
CREATE INDEX idx_pages_document ON pages(document_id);

-- -------------------------------------------------------- chunks (brief: book_chunks)
-- The physical table keeps its name `chunks`. `page` is pdf_page_start. Chapter and section names
-- come from sections via section_id. chunk_type `solution` is not stored: solutions live on
-- exercises.
ALTER TABLE chunks ADD COLUMN pdf_page_end INTEGER;
ALTER TABLE chunks ADD COLUMN printed_page_start INTEGER;
ALTER TABLE chunks ADD COLUMN printed_page_end INTEGER;
UPDATE chunks SET
  pdf_page_end = page,
  printed_page_start = page + (SELECT page_offset FROM documents d WHERE d.id = chunks.document_id),
  printed_page_end = page + (SELECT page_offset FROM documents d WHERE d.id = chunks.document_id);

-- Brief: section_summaries(..., embedding). The summary text is sections.summary; its vector:
CREATE TABLE section_embeddings (
  section_id TEXT PRIMARY KEY REFERENCES sections(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vector BLOB NOT NULL
);

-- ------------------------------------------------------------- lecture_units
CREATE TABLE lecture_units (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  transcription_json TEXT,
  embedding BLOB,
  query_text TEXT,
  UNIQUE (document_id, unit_no)
);
CREATE INDEX idx_units_document ON lecture_units(document_id);

-- ----------------------------------------------------------- alignment_edges
-- Replaces the Phase 0 `edges` table, which is now unused (it pointed sections at sections and
-- used different relation names). `edges` stays because SQLite cannot cleanly drop it inside the
-- migration chain; nothing reads or writes it.
CREATE TABLE alignment_edges (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES lecture_units(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('covers', 'extends', 'conflicts')),
  confidence REAL NOT NULL DEFAULT 0,
  signals_json TEXT NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL DEFAULT '',
  evidence_unit TEXT NOT NULL DEFAULT '',
  evidence_book TEXT NOT NULL DEFAULT '',
  quote_verified INTEGER NOT NULL DEFAULT 0,
  claim_verdict TEXT NOT NULL DEFAULT 'n/a' CHECK (claim_verdict IN ('yes', 'partial', 'no', 'n/a')),
  conflict_type TEXT
    CHECK (conflict_type IN ('notation', 'definition', 'sign_convention', 'formula', 'scope')),
  user_status TEXT NOT NULL DEFAULT 'none'
    CHECK (user_status IN ('none', 'confirmed', 'rejected', 'remapped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (unit_id, chunk_id)
);
CREATE INDEX idx_aedges_unit ON alignment_edges(unit_id);
CREATE INDEX idx_aedges_chunk ON alignment_edges(chunk_id);

CREATE TABLE unit_flags (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES lecture_units(id) ON DELETE CASCADE,
  flag TEXT NOT NULL CHECK (flag IN ('professor_only')),
  UNIQUE (unit_id, flag)
);
CREATE TABLE chunk_flags (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  flag TEXT NOT NULL CHECK (flag IN ('book_only')),
  UNIQUE (chunk_id, flag)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES alignment_edges(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('confirm', 'reject', 'remap')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_feedback_edge ON feedback(edge_id);

-- ----------------------------------------------------------------- exercises
ALTER TABLE exercises ADD COLUMN printed_page INTEGER;
ALTER TABLE exercises ADD COLUMN difficulty REAL;
ALTER TABLE exercises ADD COLUMN level TEXT NOT NULL DEFAULT 'standard'
  CHECK (level IN ('intro', 'standard', 'advanced'));
ALTER TABLE exercises ADD COLUMN topic_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE exercises ADD COLUMN verifiable INTEGER NOT NULL DEFAULT 0;
UPDATE exercises SET printed_page = page +
  (SELECT page_offset FROM documents d WHERE d.id = exercises.document_id);

CREATE TABLE exercise_matches (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES lecture_units(id) ON DELETE CASCADE,
  route TEXT NOT NULL CHECK (route IN ('inherited', 'direct')),
  score REAL NOT NULL,
  signals_json TEXT NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL DEFAULT '',
  user_status TEXT NOT NULL DEFAULT 'none'
    CHECK (user_status IN ('none', 'confirmed', 'rejected', 'remapped'))
);
CREATE INDEX idx_ematches_exercise ON exercise_matches(exercise_id);
CREATE INDEX idx_ematches_unit ON exercise_matches(unit_id);

CREATE TABLE exercise_progress (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL UNIQUE REFERENCES exercises(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'attempted', 'solved', 'struggled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------------ concepts
CREATE TABLE concepts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL
);
CREATE INDEX idx_concepts_book ON concepts(book_id);
CREATE TABLE concept_deps (
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (concept_id, depends_on_id)
);

-- ---------------------------------------------------------------------- chat
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_sessions_course ON chat_sessions(course_id);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tool_calls_json TEXT NOT NULL DEFAULT '[]',
  -- Each citation carries its own `status` (verified | unverified).
  citations_json TEXT NOT NULL DEFAULT '[]',
  unverified_calculation INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- -------------------------------------------------- verification, cache, usage
CREATE TABLE verifications (
  id TEXT PRIMARY KEY,
  exercise_id TEXT REFERENCES exercises(id) ON DELETE SET NULL,
  script TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'mismatch', 'error')),
  expected TEXT NOT NULL DEFAULT '',
  got TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_verifications_exercise ON verifications(exercise_id);

CREATE TABLE llm_cache (
  hash TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
