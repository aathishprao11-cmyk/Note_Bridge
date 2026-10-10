import type { EmbeddingProvider, LLMProvider } from '../providers/llm';
import type { SourceRole } from '../types';
import { assessTranscription, pageFromText, sniffImageType, transcribeImage } from './handwriting';
import { extractPdf } from './pdf';
import {
  IngestError,
  type OutlineItem,
  type PageQuality,
  type PageText,
  type ProgressFn,
} from './types';

export interface IngestInput {
  documentId: string;
  role: SourceRole;
  title: string;
  bytes: Uint8Array;
  /** User-entered text, one physical page per ---PAGE--- separated block. No vision call. */
  transcript?: string;
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
  onProgress?: ProgressFn;
  /**
   * Optional: render a PDF page to a PNG so the vision fallback can read it. Without it,
   * pages that need vision are skipped with a warning (rendering needs a canvas library).
   */
  renderPage?: (page: number) => Promise<Uint8Array>;
}

/** Progress never goes backwards, whatever order stages report in. */
export function monotonic(onProgress?: ProgressFn): ProgressFn {
  let last = 0;
  return (p) => {
    last = Math.max(last, p.progress);
    onProgress?.({ ...p, progress: last });
  };
}

export interface LoadedPages {
  pages: PageText[];
  pageCount: number;
  outline: OutlineItem[];
}

export async function loadPages(
  input: IngestInput,
  warnings: string[],
  report: ProgressFn,
): Promise<LoadedPages> {
  if (input.transcript !== undefined) {
    if (input.role !== 'notes' || !input.transcript.trim() || input.transcript.length > 50_000) {
      throw new IngestError(
        'Supply a non-empty handwritten transcript of at most 50,000 characters.',
      );
    }
    const isImage = sniffImageType(input.bytes) !== null;
    const isPdf = Buffer.from(input.bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
    if (!isImage && !isPdf)
      throw new IngestError('Attach a PDF, PNG or JPEG for handwritten notes.');
    // Reading the PDF verifies it and gets the physical page count; no rendering/OCR is needed.
    const pageCount = isImage ? 1 : (await extractPdf(input.bytes)).pageCount;
    const parts = input.transcript.replace(/\r\n?/g, '\n').split(/^\s*---PAGE---\s*$/m);
    if (parts.length !== pageCount) {
      throw new IngestError(
        `This file has ${pageCount} page(s), but the transcript has ${parts.length} block(s). Separate each page with ---PAGE--- on its own line.`,
      );
    }
    if (parts.some((part) => !part.trim())) {
      throw new IngestError('Every page needs a transcript; do not leave page blocks empty.');
    }
    report({
      stage: 'transcribe',
      progress: 0.1,
      message: 'Using your manual transcript (no OCR)',
    });
    warnings.push('Manually entered transcript. It has not been checked against the handwriting.');
    return { pages: parts.map((text, i) => pageFromText(i + 1, text)), pageCount, outline: [] };
  }
  if (sniffImageType(input.bytes)) {
    report({ stage: 'transcribe', progress: 0.1, message: 'Reading image' });
    const t = await transcribeImage(input.llm, input.bytes);
    if (t.lowConfidence) {
      warnings.push('Handwriting transcription has low confidence; review the text.');
    }
    return { pages: [pageFromText(1, t.text)], pageCount: 1, outline: [] };
  }
  report({ stage: 'extract', progress: 0.05, message: 'Extracting text' });
  const pdf = await extractPdf(input.bytes);
  return { pages: pdf.pages, pageCount: pdf.pageCount, outline: pdf.outline };
}

/** Replace pages that need vision with transcribed text when a renderer is available. */
export async function applyVision(
  input: IngestInput,
  pages: PageText[],
  quality: PageQuality[],
  warnings: string[],
): Promise<void> {
  for (const q of quality) {
    if (q.verdict !== 'vision') continue;
    const idx = pages.findIndex((p) => p.page === q.page);
    if (!input.renderPage || !input.llm.vision || idx < 0) {
      warnings.push(
        `Page ${q.page} needs vision (${q.reasons.join('; ')}) but no page renderer is available; skipped.`,
      );
      q.verdict = 'reject';
      continue;
    }
    const png = await input.renderPage(q.page);
    const t = await transcribeImage(input.llm, png);
    const replaced = pageFromText(q.page, t.text);
    pages[idx] = replaced;
    const re = assessTranscription(replaced);
    q.score = re.score;
    q.verdict = re.verdict === 'ok' ? 'ok' : 'reject';
    if (t.lowConfidence) warnings.push(`Page ${q.page}: vision transcription has low confidence.`);
  }
}

export async function summarize(
  llm: LLMProvider,
  title: string,
  text: string,
): Promise<string | null> {
  if (!text.trim()) return null;
  const res = await llm.complete({
    messages: [
      {
        role: 'system',
        content: 'Summarize this course section in one or two plain sentences. No preamble.',
      },
      { role: 'user', content: `Section: ${title}\n\n${text.slice(0, 3000)}` },
    ],
    maxTokens: 120,
    temperature: 0,
  });
  return res.text.trim() || null;
}
