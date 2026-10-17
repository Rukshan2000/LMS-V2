// Temporary platform-admin CLI until the console exists (Phase 3 removes it). Uses the same
// service functions the console will, so every action is audited. docs/runbooks/billing.md.
import { createHash } from 'node:crypto';
import { createKnex } from '@lms/db';
import { HttpError } from '../../lib/http-error.js';
import { parsePhone } from '../../lib/phone.js';
import { generateInvoices, recordPayment, voidInvoice } from './service.js';

const USAGE = `Usage (env DATABASE_URL, BILLING_ADMIN_PHONE):
  billing generate <YYYY-MM>
  billing pay <invoice-number> <amount> <bank-reference>
  billing void <invoice-number> <reason>`;

const [command, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
const phone = parsePhone(process.env.BILLING_ADMIN_PHONE ?? '');
const valid =
  (command === 'generate' && args.length === 1) ||
  (command === 'pay' && args.length === 3) ||
  (command === 'void' && args.length >= 2);
if (!valid || !url || !phone) {
  console.error(USAGE);
  process.exit(1);
}

const db = createKnex(url, { max: 1 });
try {
  const admin = await db('users').where({ phone, is_platform_admin: true }).first('id');
  if (!admin) throw new Error(`${phone} is not a platform admin (users.is_platform_admin)`);
  const actor = { userId: admin.id as string };
  const invoiceId = async (number: string) => {
    const row = await db('subscription_invoices').where({ number }).first('id');
    if (!row) throw new Error(`No invoice ${number}`);
    return row.id as string;
  };

  if (command === 'generate') {
    const invoices = await generateInvoices(db, args[0]!, actor);
    for (const i of invoices) console.log(`${i.number}  LKR ${i.total}  due ${i.dueDate}`);
    console.log(`${invoices.length} invoice(s) generated for ${args[0]}`);
  } else if (command === 'pay') {
    const [number, amount, reference] = args as [string, string, string];
    // Same invoice + bank reference = same payment, so running the command twice records once.
    const hex = createHash('sha256').update(`${number}:${reference}`).digest('hex');
    const clientRef = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    const result = await recordPayment(
      db,
      await invoiceId(number),
      { amount, reference, clientRef },
      actor,
    );
    console.log(`${number}: ${result.status}, LKR ${result.amountDue} still due`);
  } else {
    const [number, ...reason] = args as [string, ...string[]];
    await voidInvoice(db, await invoiceId(number), reason.join(' '), actor);
    console.log(`${number}: void`);
  }
} catch (err) {
  console.error(err instanceof HttpError || err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
