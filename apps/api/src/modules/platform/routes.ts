import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emailSchema } from '../../lib/email.js';
import { accountReadyMail } from '../../lib/mail-templates.js';
import { amountInput } from '../../lib/money.js';
import { normalizePhone } from '../../lib/phone.js';
import {
  clearOverride,
  createAccount,
  createPriceBook,
  extendTrial,
  generateInvoices,
  getAccount,
  getSettings,
  KEYS,
  listAccounts,
  listAudit,
  listInvoices,
  listPriceBooks,
  previewInvoices,
  recordPayment,
  recountUsage,
  setOverride,
  suspendAccount,
  unclaimedOwnerEmail,
  unsuspendAccount,
  updateAccount,
  updatePriceBook,
  updateSetting,
  voidInvoice,
  type Actor,
} from '../billing/index.js';
import { DOCS } from './docs.js';

// Super admin console API, /api/v1/admin (docs/SAAS_PLAN.md §10.2). Platform admins only; every
// other caller gets 404. Reads and writes go through billing's functions, which audit each change.

const idParams = z.object({ id: z.uuid() });
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reason = z.object({ reason: z.string().trim().min(1).max(300) });
const STATES = ['trial', 'trial_ending', 'active', 'overdue', 'restricted', 'suspended'] as const;

const accountsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(STATES).optional(),
});
const createAccountBody = z.object({
  name: z.string().trim().min(1).max(200),
  ownerEmail: emailSchema,
  // Contact only (WhatsApp). Optional.
  ownerPhone: z
    .string()
    .max(20)
    .optional()
    .transform((v) => (v?.trim() ? normalizePhone(v) : null)),
  priceBook: z.string().min(1).max(32),
  trialDays: z.number().int().min(0).max(365),
});
const patchAccountBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(5000).nullable(),
    priceBook: z.string().min(1).max(32),
    ownerEmail: emailSchema,
  })
  .partial();
const overrideParams = idParams.extend({ key: z.string().max(64) });
const overrideBody = z.object({
  value: z.unknown(),
  expiresAt: z.coerce.date().nullable().default(null),
  note: z.string().trim().min(1).max(300),
});
const invoicesQuery = z.object({
  period: period.optional(),
  status: z.enum(['open', 'paid', 'void']).optional(),
});
const paymentBody = z.object({
  amount: amountInput,
  reference: z.string().trim().min(1).max(100),
  clientRef: z.uuid(),
});
const bookValues = z.record(z.string(), z.unknown());
const priceBookBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  values: bookValues,
});
const newPriceBookBody = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,32}$/),
  name: z.string().trim().min(1).max(100),
  values: bookValues,
});
const auditQuery = z.object({ accountId: z.uuid().optional(), actor: z.uuid().optional() });

export default async function platformRoutes(
  app: FastifyInstance,
  { adminRateLimitMax }: { adminRateLimitMax: number },
) {
  app.addHook('onRequest', app.requirePlatformAdmin);
  // Stricter limit on changes (per IP); reads use no limit, like the rest of the API.
  const mutation = { config: { rateLimit: { max: adminRateLimitMax, timeWindow: '1 minute' } } };
  const actor = (req: FastifyRequest): Actor => ({ userId: req.user!.id, ip: req.ip });

  app.get('/accounts', async (req) => ({
    accounts: await listAccounts(app.db, accountsQuery.parse(req.query)),
  }));
  app.post('/accounts', mutation, async (req, reply) => {
    const account = await createAccount(app.db, createAccountBody.parse(req.body), actor(req));
    const emailSent = await app.sendMail(
      accountReadyMail(account.ownerEmail, account.name, app.appUrl),
    );
    return reply.status(201).send({ account, emailSent });
  });
  // Resend the "account ready" email while the owner has not signed up.
  app.post('/accounts/:id/invite', mutation, async (req) => {
    const { name, email } = await unclaimedOwnerEmail(app.db, idParams.parse(req.params).id);
    return { emailSent: await app.sendMail(accountReadyMail(email, name, app.appUrl)) };
  });
  app.get('/accounts/:id', async (req) => getAccount(app.db, idParams.parse(req.params).id));
  app.patch('/accounts/:id', mutation, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await updateAccount(app.db, id, patchAccountBody.parse(req.body), actor(req));
    return reply.status(204).send();
  });
  app.put('/accounts/:id/overrides/:key', mutation, async (req, reply) => {
    const { id, key } = overrideParams.parse(req.params);
    await setOverride(app.db, id, key, overrideBody.parse(req.body), actor(req));
    return reply.status(204).send();
  });
  app.delete('/accounts/:id/overrides/:key', mutation, async (req, reply) => {
    const { id, key } = overrideParams.parse(req.params);
    await clearOverride(app.db, id, key, actor(req));
    return reply.status(204).send();
  });
  app.post('/accounts/:id/trial', mutation, async (req) => {
    const { id } = idParams.parse(req.params);
    const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(req.body);
    return extendTrial(app.db, id, days, actor(req));
  });
  app.post('/accounts/:id/recount', mutation, async (req) =>
    recountUsage(app.db, idParams.parse(req.params).id, actor(req)),
  );
  app.post('/accounts/:id/suspend', mutation, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await suspendAccount(app.db, id, reason.parse(req.body).reason, actor(req));
    return reply.status(204).send();
  });
  app.post('/accounts/:id/unsuspend', mutation, async (req, reply) => {
    await unsuspendAccount(app.db, idParams.parse(req.params).id, actor(req));
    return reply.status(204).send();
  });

  app.get('/invoices', async (req) => ({
    invoices: await listInvoices(app.db, invoicesQuery.parse(req.query)),
  }));
  app.get('/invoices/preview', async (req) => ({
    preview: await previewInvoices(app.db, z.object({ period }).parse(req.query).period),
  }));
  app.post('/invoices/generate', mutation, async (req) => {
    const body = z.object({ period }).parse(req.body);
    const invoices = await generateInvoices(app.db, body.period, actor(req));
    return { invoices };
  });
  app.post('/invoices/:id/payments', mutation, async (req) => {
    const { id } = idParams.parse(req.params);
    return recordPayment(app.db, id, paymentBody.parse(req.body), actor(req));
  });
  app.post('/invoices/:id/void', mutation, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await voidInvoice(app.db, id, reason.parse(req.body).reason, actor(req));
    return reply.status(204).send();
  });

  // `keys`: every catalogue key, so the console's editors never keep their own list.
  app.get('/price-books', async () => ({ priceBooks: await listPriceBooks(app.db), keys: KEYS }));
  app.put('/price-books/:key', mutation, async (req) => {
    const { key } = z.object({ key: z.string().max(32) }).parse(req.params);
    return updatePriceBook(app.db, key, priceBookBody.parse(req.body), actor(req));
  });
  app.post('/price-books', mutation, async (req, reply) => {
    await createPriceBook(app.db, newPriceBookBody.parse(req.body), actor(req));
    return reply.status(201).send();
  });

  app.get('/settings', async () => ({ settings: await getSettings(app.db) }));
  app.put('/settings/:key', mutation, async (req, reply) => {
    const { key } = z.object({ key: z.string().max(64) }).parse(req.params);
    const { value } = z.object({ value: z.unknown() }).parse(req.body);
    await updateSetting(app.db, key, value, actor(req));
    return reply.status(204).send();
  });

  // Platform documentation for the console's Docs section (hidden like every route here).
  app.get('/docs', async () => ({ pages: DOCS }));

  app.get('/audit', async (req) => {
    const q = auditQuery.parse(req.query);
    return { events: await listAudit(app.db, { accountId: q.accountId, actorId: q.actor }) };
  });
}
