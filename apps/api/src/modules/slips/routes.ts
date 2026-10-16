import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { amountInput } from '../../lib/money.js';
import { getReceipt, verifySlip } from '../fees/billing.js';

const uuid = z.uuid();
const MAX_BYTES = 3 * 1024 * 1024;
// First bytes of each allowed file type: the declared type must match the actual content.
const MAGIC: Record<string, string> = {
  'image/jpeg': 'ffd8ff',
  'image/png': '89504e47',
  'image/webp': '52494646',
  'application/pdf': '25504446',
};

const param = (req: FastifyRequest) => {
  const { paymentId } = req.params as { paymentId: string };
  if (!uuid.safeParse(paymentId).success) throw notFound();
  return paymentId;
};

/** "data:image/jpeg;base64,..." → checked bytes, or 400. */
function parseFile(dataUrl: string) {
  const m = /^data:([a-z/]+);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  const type = m?.[1];
  const data = m ? Buffer.from(m[2]!, 'base64') : undefined;
  if (!type || !data || !MAGIC[type] || !data.toString('hex', 0, 4).startsWith(MAGIC[type])) {
    throw new HttpError(400, 'invalid_file', 'Upload a photo (JPG/PNG) or PDF of the slip');
  }
  if (data.length > MAX_BYTES) throw new HttpError(400, 'file_too_large', 'File is too large');
  return { type, data, sha256: createHash('sha256').update(data).digest('hex') };
}

/** Prefix /api/v1/tenants/:tenantId */
export default async function slipRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const desk = app.requireRole('owner', 'admin', 'receptionist');
  const family = app.requireRole('student', 'parent');

  // Parent/student uploads a slip for a student they have portal access to.
  app.post(
    '/portal/slips',
    {
      preHandler: family,
      bodyLimit: 5 * 1024 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = z
        .object({
          studentId: uuid,
          amount: amountInput,
          reference: z.string().trim().max(100).nullish(),
          file: z.string().max(5 * 1024 * 1024),
          clientRef: uuid,
        })
        .parse(req.body);
      const file = parseFile(body.file);
      const tenantId = req.tenant!.id;
      const result = await req.withTenant(async (trx) => {
        const access = await trx('portal_access')
          .where({ membership_id: req.tenant!.membershipId, student_id: body.studentId })
          .first('student_id');
        if (!access) return undefined;
        const previous = await trx('payments').where({ client_ref: body.clientRef }).first('id');
        if (previous) return { id: previous.id as string, duplicate: true };
        const [payment] = await trx('payments')
          .insert({
            tenant_id: tenantId,
            student_id: body.studentId,
            amount: body.amount,
            method: 'slip',
            status: 'pending',
            reference: body.reference || null,
            client_ref: body.clientRef,
            submitted_by_user_id: req.user!.id,
          })
          .returning('id');
        await trx('payment_slips').insert({
          tenant_id: tenantId,
          payment_id: payment.id,
          content_type: file.type,
          sha256: file.sha256,
          data: file.data,
        });
        return { id: payment.id as string, duplicate: false };
      });
      if (!result) throw notFound();
      return reply.status(result.duplicate ? 200 : 201).send(result);
    },
  );

  // Desk review queue. Duplicate flags: the same file, or the same bank reference, seen before.
  app.get('/slips', { preHandler: desk }, async (req) => {
    const { status } = z
      .object({ status: z.enum(['pending', 'verified', 'rejected']).default('pending') })
      .parse(req.query);
    const slips = await req.withTenant((trx) =>
      trx('payments as p')
        .join('payment_slips as ps', 'ps.payment_id', 'p.id')
        .join('students as s', 's.id', 'p.student_id')
        .leftJoin('users as u', 'u.id', 'p.submitted_by_user_id')
        .where('p.status', status)
        .orderBy('p.received_at', status === 'pending' ? 'asc' : 'desc')
        .limit(200)
        .select(
          'p.id',
          'p.amount',
          'p.reference',
          'p.status',
          'p.receipt_number as receiptNumber',
          'p.review_note as reviewNote',
          'p.received_at as submittedAt',
          'ps.content_type as contentType',
          's.id as studentId',
          's.full_name as studentName',
          's.student_number as studentNumber',
          'u.full_name as submittedBy',
          'u.phone as submittedByPhone',
          trx.raw(`(SELECT COALESCE(sum(i.total - i.paid), 0)::text FROM invoices i
            WHERE i.student_id = p.student_id AND i.status IN ('issued', 'part_paid')) AS outstanding`),
          trx.raw(`EXISTS (SELECT 1 FROM payment_slips o
            WHERE o.sha256 = ps.sha256 AND o.payment_id <> p.id) AS "duplicateFile"`),
          trx.raw(`(p.reference IS NOT NULL AND EXISTS (SELECT 1 FROM payments o
            WHERE lower(o.reference) = lower(p.reference) AND o.id <> p.id AND o.status <> 'rejected'))
            AS "duplicateReference"`),
        ),
    );
    return { slips };
  });

  app.get('/slips/:paymentId/file', { preHandler: desk }, async (req, reply) => {
    const id = param(req);
    const file = await req.withTenant((trx) =>
      trx('payment_slips').where({ payment_id: id }).first('content_type', 'data'),
    );
    if (!file) throw notFound();
    return reply
      .header('content-type', file.content_type)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, max-age=3600')
      .send(file.data);
  });

  app.post('/slips/:paymentId/verify', { preHandler: desk }, async (req) => {
    const id = param(req);
    const { amount } = z.object({ amount: amountInput.optional() }).parse(req.body ?? {});
    const receipt = await req.withTenant(async (trx) => {
      const ok = await verifySlip(trx, req.tenant!.id, req.tenant!.membershipId, id, amount);
      return ok ? getReceipt(trx, id) : undefined;
    });
    if (!receipt) throw notFound();
    return { receipt };
  });

  app.post('/slips/:paymentId/reject', { preHandler: desk }, async (req) => {
    const id = param(req);
    const { note } = z.object({ note: z.string().trim().min(1).max(200) }).parse(req.body);
    const n = await req.withTenant((trx) =>
      trx('payments').where({ id, status: 'pending' }).update({
        status: 'rejected',
        review_note: note,
        reviewed_at: trx.fn.now(),
        received_by_membership_id: req.tenant!.membershipId,
      }),
    );
    if (!n) throw notFound();
    return { rejected: true };
  });
}
