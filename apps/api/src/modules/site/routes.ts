import { withTenant } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { emailSchema } from '../../lib/email.js';
import { notFound } from '../../lib/http-error.js';
import { normalizePhone } from '../../lib/phone.js';
import { colomboToday } from '../../lib/time.js';

// The institute's public web page (docs: Settings → Public page; web route /{lang}/i/{slug}).

const https = z
  .url({ protocol: /^https$/ })
  .max(500)
  .nullish()
  .or(z.literal('').transform(() => null));
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const phone = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? normalizePhone(v) : null));

const pageInput = z.object({
  published: z.boolean(),
  tagline: text(200),
  about: text(4000),
  phone,
  whatsapp: phone,
  email: emailSchema.nullish().or(z.literal('').transform(() => null)),
  address: text(300),
  mapUrl: https,
  facebookUrl: https,
  youtubeUrl: https,
  tiktokUrl: https,
  showFees: z.boolean(),
  /** Classes to list on the page; every other class is taken off it. */
  batchIds: z.array(z.uuid()).max(200),
});

const PAGE_COLUMNS = [
  'published',
  'tagline',
  'about',
  'phone',
  'whatsapp',
  'email',
  'address',
  'map_url as mapUrl',
  'facebook_url as facebookUrl',
  'youtube_url as youtubeUrl',
  'tiktok_url as tiktokUrl',
  'show_fees as showFees',
];

const EMPTY_PAGE = {
  published: false,
  tagline: null,
  about: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  mapUrl: null,
  facebookUrl: null,
  youtubeUrl: null,
  tiktokUrl: null,
  showFees: true,
};

/** Classes marked for the page, with this week's timetable and (optionally) the monthly fees. */
async function pageClasses(trx: Knex.Transaction, showFees: boolean) {
  const batches = await trx('batches as b')
    .join('subjects as s', 's.id', 'b.subject_id')
    .leftJoin('tenant_memberships as m', 'm.id', 'b.teacher_membership_id')
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .where({ 'b.on_page': true, 'b.status': 'active' })
    .orderByRaw('lower(s.name), lower(b.name)')
    .select('b.id', 'b.name', 'b.mode', 's.name as subject', 'u.full_name as teacherName');
  if (!batches.length) return [];
  const ids = batches.map((b) => b.id);
  const today = colomboToday();
  const [schedule, fees] = await Promise.all([
    trx('schedule_rules')
      .whereIn('batch_id', ids)
      .where((q) => q.whereNull('valid_to').orWhere('valid_to', '>=', today))
      .orderBy(['weekday', 'start_time'])
      .select(
        'batch_id as batchId',
        'weekday',
        trx.raw(`to_char(start_time, 'HH24:MI') as "startTime"`),
        trx.raw(`to_char(end_time, 'HH24:MI') as "endTime"`),
      ),
    showFees
      ? trx('batch_fees')
          .whereIn('batch_id', ids)
          .where('amount', '>', 0)
          .select('batch_id as batchId', 'kind', 'amount')
      : [],
  ]);
  return batches.map(({ id, ...b }) => ({
    ...b,
    schedule: schedule
      .filter((r) => r.batchId === id)
      .map((r) => ({ weekday: r.weekday as number, startTime: r.startTime, endTime: r.endTime })),
    fees: fees
      .filter((f) => f.batchId === id)
      .map((f) => ({ kind: f.kind as string, amount: f.amount as string })),
  }));
}

/** Staff side: edit the page. Registered under /tenants/:tenantId. */
export async function siteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const managers = app.requireRole('owner', 'admin');

  app.get('/page', { preHandler: managers }, async (req) =>
    req.withTenant(async (trx) => {
      const page = await trx('tenant_pages').first(PAGE_COLUMNS);
      const batches = await trx('batches as b')
        .join('subjects as s', 's.id', 'b.subject_id')
        .where('b.status', 'active')
        .orderByRaw('lower(s.name), lower(b.name)')
        .select('b.id', 'b.name', 's.name as subject', 'b.on_page as onPage');
      return { page: page ?? EMPTY_PAGE, batches };
    }),
  );

  app.put('/page', { preHandler: managers }, async (req) => {
    const { batchIds, ...body } = pageInput.parse(req.body);
    const tenantId = req.tenant!.id;
    return req.withTenant(async (trx) => {
      const row = {
        published: body.published,
        tagline: body.tagline,
        about: body.about,
        phone: body.phone,
        whatsapp: body.whatsapp,
        email: body.email ?? null,
        address: body.address,
        map_url: body.mapUrl ?? null,
        facebook_url: body.facebookUrl ?? null,
        youtube_url: body.youtubeUrl ?? null,
        tiktok_url: body.tiktokUrl ?? null,
        show_fees: body.showFees,
        updated_at: trx.fn.now(),
      };
      const [page] = await trx('tenant_pages')
        .insert({ tenant_id: tenantId, ...row })
        .onConflict('tenant_id')
        .merge(row)
        .returning(PAGE_COLUMNS);
      // Ids from another institute match nothing (RLS), so they are ignored.
      await trx('batches').update({ on_page: trx.raw('id = ANY(?::uuid[])', [batchIds]) });
      return { page };
    });
  });
}

/** Public side: anyone can read a published page. Registered under /public. */
export async function publicSiteRoutes(app: FastifyInstance) {
  // The web server renders and caches these pages, so real traffic here is light.
  const config = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  app.get('/institutes/:slug', { config }, async (req) => {
    const { slug } = req.params as { slug: string };
    if (!/^[a-z0-9-]{3,60}$/.test(slug)) throw notFound();
    const tenant = await app
      .db('tenants')
      .where({ slug })
      .whereNot('status', 'suspended')
      .first('id', 'slug', 'name', 'theme');
    if (!tenant) throw notFound();
    // tenant.id comes from the server lookup above, never from the request.
    const result = await withTenant(app.db, { tenantId: tenant.id }, async (trx) => {
      const page = await trx('tenant_pages')
        .where({ published: true })
        .first(PAGE_COLUMNS.filter((c) => c !== 'published'));
      if (!page) return undefined;
      return { page, classes: await pageClasses(trx, page.showFees) };
    });
    if (!result) throw notFound();
    return { institute: { slug: tenant.slug, name: tenant.name, theme: tenant.theme }, ...result };
  });
}
