import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';

// Tutes: class notes with a download link (no file storage). Owner/admin manage every class's
// tutes, a teacher only their own classes'. Students and parents see the tutes of the classes
// their linked students are enrolled in.

const uuid = z.uuid();
const tuteInput = z.object({
  batchId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  url: z.url({ protocol: /^https$/ }).max(1000),
});

const param = (req: FastifyRequest) => {
  const { tuteId } = req.params as { tuteId: string };
  if (!uuid.safeParse(tuteId).success) throw notFound();
  return tuteId;
};
const isManager = (req: FastifyRequest) =>
  req.tenant!.roles.some((r) => r === 'owner' || r === 'admin');
const visible = (req: FastifyRequest) => (q: Knex.QueryBuilder) => {
  if (!isManager(req)) q.where('b.teacher_membership_id', req.tenant!.membershipId);
};

const COLUMNS = [
  't.id',
  't.batch_id as batchId',
  'b.name as batchName',
  't.title',
  't.description',
  't.url',
  't.created_at as createdAt',
];

/** Prefix /api/v1/tenants/:tenantId */
export default async function tuteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const staff = app.requireRole('owner', 'admin', 'teacher');
  const family = app.requireRole('student', 'parent');

  /** The class, if this user may manage its tutes; 400 otherwise. */
  const ownBatch = async (trx: Knex.Transaction, req: FastifyRequest, batchId: string) => {
    const batch = await trx('batches as b')
      .where({ 'b.id': batchId, 'b.status': 'active' })
      .modify(visible(req))
      .first('b.id');
    if (!batch) throw new HttpError(400, 'invalid_reference', 'Unknown class');
  };
  const getTute = (trx: Knex.Transaction, req: FastifyRequest, id: string) =>
    trx('tutes as t')
      .join('batches as b', 'b.id', 't.batch_id')
      .where('t.id', id)
      .modify(visible(req))
      .first(COLUMNS);

  app.get('/tutes', { preHandler: staff }, async (req) => {
    const { batchId } = z.object({ batchId: uuid.optional() }).parse(req.query);
    const tutes = await req.withTenant((trx) =>
      trx('tutes as t')
        .join('batches as b', 'b.id', 't.batch_id')
        .modify(visible(req))
        .modify((q) => {
          if (batchId) q.where('t.batch_id', batchId);
        })
        .orderBy('t.created_at', 'desc')
        .select(COLUMNS),
    );
    return { tutes };
  });

  app.post('/tutes', { preHandler: staff }, async (req, reply) => {
    const body = tuteInput.parse(req.body);
    const tute = await req.withTenant(async (trx) => {
      await ownBatch(trx, req, body.batchId);
      const [row] = await trx('tutes')
        .insert({
          tenant_id: req.tenant!.id,
          batch_id: body.batchId,
          title: body.title,
          description: body.description || null,
          url: body.url,
          created_by_membership_id: req.tenant!.membershipId,
        })
        .returning('id');
      return getTute(trx, req, row.id);
    });
    return reply.status(201).send({ tute });
  });

  app.patch('/tutes/:tuteId', { preHandler: staff }, async (req) => {
    const id = param(req);
    const body = tuteInput.partial().parse(req.body);
    const tute = await req.withTenant(async (trx) => {
      if (!(await getTute(trx, req, id))) throw notFound();
      if (body.batchId) await ownBatch(trx, req, body.batchId);
      const fields = {
        batch_id: body.batchId,
        title: body.title,
        description: body.description === undefined ? undefined : body.description || null,
        url: body.url,
      };
      await trx('tutes')
        .where({ id })
        .update({
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
          updated_at: trx.fn.now(),
        });
      return getTute(trx, req, id);
    });
    return { tute };
  });

  app.delete('/tutes/:tuteId', { preHandler: staff }, async (req, reply) => {
    const id = param(req);
    await req.withTenant(async (trx) => {
      if (!(await getTute(trx, req, id))) throw notFound();
      await trx('tutes').where({ id }).del();
    });
    return reply.status(204).send();
  });

  // Portal: tutes of every class a linked student is enrolled in, newest first.
  app.get('/portal/tutes', { preHandler: family }, async (req) => {
    const tutes = await req.withTenant((trx) =>
      trx('tutes as t')
        .join('batches as b', 'b.id', 't.batch_id')
        .where('b.status', 'active')
        .whereIn(
          't.batch_id',
          trx('enrollments as e')
            .join('portal_access as pa', 'pa.student_id', 'e.student_id')
            .where({ 'pa.membership_id': req.tenant!.membershipId, 'e.status': 'active' })
            .select('e.batch_id'),
        )
        .orderBy('t.created_at', 'desc')
        .select(COLUMNS),
    );
    return { tutes };
  });
}
