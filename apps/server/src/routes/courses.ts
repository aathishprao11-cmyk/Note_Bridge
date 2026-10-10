import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { CourseParams, CourseResponse, CreateCourseBody, ListCoursesResponse } from '@gyan/core';
import type { Db } from '../db';
import { badRequest, fail, send, toCourse } from './shared';

type CourseRow = { id: string; name: string; created_at: string };

/** POST /api/courses, GET /api/courses, GET /api/courses/:id */
export function registerCourseRoutes(app: FastifyInstance, db: Db) {
  app.post('/api/courses', async (req, reply) => {
    const body = CreateCourseBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    const id = `course_${randomUUID()}`;
    db.prepare('INSERT INTO courses (id, name) VALUES (?, ?)').run(id, body.data.name);
    const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow;
    return send(reply, CourseResponse, toCourse(row), 201);
  });

  app.get('/api/courses', async (_req, reply) => {
    const rows = db.prepare('SELECT * FROM courses ORDER BY created_at, id').all() as CourseRow[];
    return send(reply, ListCoursesResponse, rows.map(toCourse));
  });

  app.get('/api/courses/:id', async (req, reply) => {
    const params = CourseParams.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error);
    const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(params.data.id) as
      CourseRow | undefined;
    if (!row) return fail(reply, 404, 'course_not_found', `No course with id "${params.data.id}"`);
    return send(reply, CourseResponse, toCourse(row));
  });
}
