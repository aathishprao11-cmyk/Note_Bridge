import type { FastifyInstance } from 'fastify';
import { PageParams, PageResponse, QualityParams, QualityResponse, type Page } from '@gyan/core';
import type { Db } from '../db';
import { badRequest, chunkRefs, fail, send } from './shared';

interface PageRow {
  id: string;
  document_id: string;
  pdf_page: number;
  printed_page: number | null;
  text: string;
  image_path: string | null;
  ocr_confidence: number | null;
  is_scanned: number;
  garbled_score: number;
  reextracted: number;
}

interface DocRow {
  id: string;
  title: string;
  page_count: number;
  page_offset: number;
  offset_confidence: number;
  extraction_quality: number | null;
  warnings: string;
  page_quality: string;
}

const toPage = (r: PageRow): Page => ({
  id: r.id,
  documentId: r.document_id,
  pdfPage: r.pdf_page,
  printedPage: r.printed_page,
  text: r.text,
  imagePath: r.image_path,
  ocrConfidence: r.ocr_confidence,
  isScanned: r.is_scanned === 1,
  garbledScore: r.garbled_score,
  reextracted: r.reextracted === 1,
});

/** GET /api/documents/:id/pages/:n and GET /api/documents/:id/quality */
export function registerDocumentRoutes(app: FastifyInstance, db: Db) {
  const getDoc = (id: string) =>
    db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocRow | undefined;

  app.get('/api/documents/:id/pages/:n', async (req, reply) => {
    const params = PageParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    const doc = getDoc(params.data.id);
    if (!doc) return fail(reply, 404, 'document_not_found', `No document "${params.data.id}"`);
    const page = db
      .prepare('SELECT * FROM pages WHERE document_id = ? AND pdf_page = ?')
      .get(doc.id, params.data.n) as PageRow | undefined;
    if (!page) {
      return fail(reply, 404, 'page_not_found', `Document has no page ${params.data.n}`);
    }
    const onPage = (
      db
        .prepare(
          'SELECT id FROM chunks WHERE document_id = ? AND page <= ? AND COALESCE(pdf_page_end, page) >= ? ORDER BY ordinal',
        )
        .all(doc.id, page.pdf_page, page.pdf_page) as Array<{ id: string }>
    ).map((c) => c.id);
    const refs = chunkRefs(db, onPage);
    return send(reply, PageResponse, {
      page: toPage(page),
      documentTitle: doc.title,
      pageCount: doc.page_count,
      chunks: onPage.map((id) => refs[id]).filter(Boolean),
    });
  });

  app.get('/api/documents/:id/quality', async (req, reply) => {
    const params = QualityParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    const doc = getDoc(params.data.id);
    if (!doc) return fail(reply, 404, 'document_not_found', `No document "${params.data.id}"`);
    const verdicts = new Map(
      (
        JSON.parse(doc.page_quality) as Array<{
          page: number;
          score: number;
          verdict: 'ok' | 'vision' | 'reject';
          reasons: string[];
        }>
      ).map((q) => [q.page, q]),
    );
    const pages = (
      db
        .prepare('SELECT * FROM pages WHERE document_id = ? ORDER BY pdf_page')
        .all(doc.id) as PageRow[]
    ).map((p) => {
      const q = verdicts.get(p.pdf_page);
      return {
        pdfPage: p.pdf_page,
        printedPage: p.printed_page,
        score: q?.score ?? 1 - p.garbled_score,
        garbledScore: p.garbled_score,
        verdict: q?.verdict ?? 'ok',
        isScanned: p.is_scanned === 1,
        reextracted: p.reextracted === 1,
        reasons: q?.reasons ?? [],
      };
    });
    return send(reply, QualityResponse, {
      documentId: doc.id,
      extractionQuality: doc.extraction_quality,
      pageOffset: doc.page_offset,
      offsetConfidence: doc.offset_confidence,
      warnings: JSON.parse(doc.warnings) as string[],
      pages,
    });
  });
}
