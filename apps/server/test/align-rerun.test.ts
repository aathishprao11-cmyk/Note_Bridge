import { describe, expect, it } from 'vitest';
import { AlignmentResponse } from '@gyan/core';
import { FRICTION, pdf, setup } from './align-helpers';

describe('re-running alignment', () => {
  it('keeps the student decisions and does not duplicate edges', async () => {
    const { app, courseId, upload, align } = await setup();
    await upload('book', 'b.pdf', await pdf([{ title: '1 Friction', body: FRICTION }]));
    await upload(
      'slides',
      's.pdf',
      await pdf([
        {
          title: 'Friction',
          body: 'Friction force and the normal force between sliding surfaces.',
        },
      ]),
    );
    const edges = async () =>
      AlignmentResponse.parse(
        (await app.inject({ method: 'GET', url: `/api/courses/${courseId}/alignment` })).json(),
      ).edges;

    await align();
    const first = (await edges())[0]!;
    await app.inject({
      method: 'PATCH',
      url: `/api/edges/${first.id}`,
      payload: { action: 'confirm' },
    });

    await align();
    const after = await edges();
    expect(after.find((e) => e.id === first.id)?.userStatus).toBe('confirmed');
    expect(after.filter((e) => e.chunkId === first.chunkId)).toHaveLength(1);
    await app.close();
  });
});
