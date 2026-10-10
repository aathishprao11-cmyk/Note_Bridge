import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect } from 'vitest';
import { parseConfig } from '@gyan/core';
import { buildApp } from '../src/app';
import { multipart } from './multipart-helpers';

/** A real PDF: each entry is one page, drawn as a title and wrapped body lines. */
export async function pdf(pages: Array<{ title: string; body: string }>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    page.drawText(p.title, { x: 72, y, size: 20, font });
    y -= 40;
    let row = '';
    const rows: string[] = [];
    for (const w of p.body.split(' ')) {
      const next = row ? `${row} ${w}` : w;
      if (font.widthOfTextAtSize(next, 11) > 468 && row) {
        rows.push(row);
        row = w;
      } else row = next;
    }
    rows.push(row);
    for (const r of rows) {
      page.drawText(r, { x: 72, y, size: 11, font });
      y -= 16;
    }
  }
  return doc.save();
}

export const FRICTION =
  'Friction is the contact force that opposes sliding between two surfaces. The friction force equals the coefficient of friction times the normal force. Static friction adjusts up to a maximum value before sliding starts. Kinetic friction acts once the surfaces slide and is usually smaller than static friction.';
export const HEAT =
  'Heat flows from hot objects to cold objects until their temperatures become equal. Thermal conductivity measures how quickly heat moves through a material. Insulation slows the flow of heat between a warm room and the cold air outside.';

const JSON_HEADER = { 'content-type': 'application/json' };

export async function setup() {
  const built = await buildApp({ config: parseConfig({ DATABASE_PATH: ':memory:' }) });
  const { app, runner } = built;
  const made = await app.inject({ method: 'POST', url: '/api/courses', payload: { name: 'Live' } });
  const courseId = made.json().id as string;
  const upload = async (kind: string, name: string, bytes: Uint8Array) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/courses/${courseId}/documents`,
      ...multipart({ kind }, { name, bytes }),
    });
    expect(res.statusCode).toBe(202);
    await runner.idle();
  };
  /** Run alignment and return the finished job record. */
  const align = async () => {
    const run = await app.inject({
      method: 'POST',
      url: `/api/courses/${courseId}/align`,
      headers: JSON_HEADER,
    });
    await runner.idle();
    return (await app.inject({ method: 'GET', url: `/api/jobs/${run.json().jobId}` })).json();
  };
  return { app, courseId, upload, align };
}
