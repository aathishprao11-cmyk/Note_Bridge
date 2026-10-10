import { adapterFor } from './adapters';
import { chunkDocument } from './chunker';
import { extractExercises } from './exercises';
import { contentHash } from './hash';
import { applyVision, loadPages, monotonic, summarize, type IngestInput } from './ingest-steps';
import { stripPageFurniture } from './furniture';
import { fitPageOffset, type OffsetResult } from './offsets';
import { assessPages } from './quality';
import { buildStructure } from './structure';
import {
  IngestError,
  type ChunkDraft,
  type ExerciseDraft,
  type PageQuality,
  type SectionDraft,
} from './types';

export type { IngestInput } from './ingest-steps';

export interface IngestResult {
  contentHash: string;
  pageCount: number;
  pageOffset: number;
  offset: OffsetResult;
  headingSource: string;
  pageQuality: PageQuality[];
  sections: Array<SectionDraft & { summary: string | null }>;
  chunks: ChunkDraft[];
  exercises: ExerciseDraft[];
  /** Same order as `chunks`. */
  embeddings: number[][];
  embeddingModel: string;
  warnings: string[];
  /** Text to expose on the page endpoint, including manually supplied transcripts. */
  pageTexts?: Array<{ page: number; text: string }>;
  manualTranscript?: boolean;
}

const EMBED_BATCH = 32;

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const report = monotonic(input.onProgress);
  const warnings: string[] = [];
  const adapter = adapterFor(input.role);
  const hash = contentHash(input.bytes);

  const { pages, pageCount, outline } = await loadPages(input, warnings, report);

  report({ stage: 'quality', progress: 0.2, message: 'Checking text quality' });
  // Manual text is user-supplied, not OCR: don't reject short formulas or non-English notes
  // using the English PDF garble heuristic. This score is readability, not transcription accuracy.
  const quality =
    input.transcript !== undefined
      ? pages.map((p): PageQuality => ({
          page: p.page,
          score: 1,
          verdict: 'ok',
          reasons: ['manual transcript; not OCR verified'],
          formulaHeavy: false,
          scanned: false,
        }))
      : assessPages(pages);
  await applyVision(input, pages, quality, warnings);
  const rejected = new Set(quality.filter((q) => q.verdict === 'reject').map((q) => q.page));
  for (const q of quality) {
    if (q.verdict === 'reject' && !warnings.some((w) => w.startsWith(`Page ${q.page}`))) {
      warnings.push(`Page ${q.page} excluded: ${q.reasons.join('; ') || 'unreadable'}.`);
    }
  }
  if (rejected.size === pages.length) {
    throw new IngestError(
      'No readable text found in this file. Try a clearer scan or a text-based PDF.',
    );
  }

  report({ stage: 'offsets', progress: 0.3, message: 'Matching printed page numbers' });
  const readable = pages.filter((p) => !rejected.has(p.page));
  const offset: OffsetResult = adapter.fitOffsets
    ? fitPageOffset(readable)
    : { offset: 0, confidence: 1, votes: 0, samples: 0 };
  if (adapter.fitOffsets && offset.offset === 0 && offset.confidence < 0.5) {
    warnings.push('Could not confidently detect printed page numbers; showing PDF page numbers.');
  }

  report({ stage: 'structure', progress: 0.4, message: 'Finding sections' });
  // After offsets (which need the printed numbers): drop headers, footers and page numbers.
  const body = input.transcript !== undefined ? readable : stripPageFurniture(readable);
  const structure = buildStructure({
    pages: body,
    outline,
    role: input.role,
    docTitle: input.title,
  });

  report({ stage: 'chunk', progress: 0.5, message: 'Splitting into chunks' });
  const chunks = chunkDocument(
    {
      documentId: input.documentId,
      docTitle: input.title,
      pages: body,
      sections: structure.sections,
      qualityByPage: new Map(quality.map((q) => [q.page, q.score])),
    },
    adapter.chunk,
  );
  const exercises = adapter.exercises ? extractExercises(input.documentId, chunks) : [];

  report({ stage: 'summaries', progress: 0.6, message: 'Summarizing sections' });
  const sections: IngestResult['sections'] = [];
  for (const [i, s] of structure.sections.entries()) {
    const body = chunks
      .filter((c) => c.sectionIndex === s.index)
      .map((c) => c.text)
      .join('\n');
    sections.push({ ...s, summary: await summarize(input.llm, s.title, body) });
    report({
      stage: 'summaries',
      progress: 0.6 + 0.15 * ((i + 1) / structure.sections.length),
      message: 'Summarizing sections',
    });
  }

  // Embed header + text. The header is for retrieval only; it is never stored as display text.
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const texts = batch.map((c) => `${c.contextHeader}\n${c.text}`);
    embeddings.push(...(await input.embeddings.embed(texts)));
    report({
      stage: 'embed',
      progress: 0.75 + 0.2 * Math.min(1, (i + batch.length) / Math.max(1, chunks.length)),
      message: 'Embedding chunks',
    });
  }

  report({ stage: 'done', progress: 1, message: 'Ingestion complete' });
  return {
    contentHash: hash,
    pageCount,
    pageOffset: offset.offset,
    offset,
    headingSource: structure.source,
    pageQuality: quality,
    sections,
    chunks,
    exercises,
    embeddings,
    embeddingModel: input.embeddings.id,
    warnings,
    pageTexts: readable.map((p) => ({ page: p.page, text: p.text })),
    manualTranscript: input.transcript !== undefined,
  };
}
