import type { Mail } from './mail.js';

// Plain templates: a text part always, and minimal HTML. English for now.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function mail(to: string, subject: string, lines: string[], link?: { url: string; label: string }) {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.url}`] : [])].join('\n');
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">` +
    lines.map((l) => (l ? `<p>${esc(l)}</p>` : '')).join('') +
    (link ? `<p><a href="${esc(link.url)}">${esc(link.label)}</a></p>` : '') +
    `</div>`;
  return { to, subject, text, html } satisfies Mail;
}

export type OtpPurpose = 'signup' | 'password_reset' | 'email_change';

const otpReason: Record<OtpPurpose, string> = {
  signup: 'to create your account',
  password_reset: 'to reset your password',
  email_change: 'to confirm your email address',
};

export const otpMail = (to: string, code: string, purpose: OtpPurpose) =>
  mail(to, `${code} is your verification code`, [
    `Your code ${otpReason[purpose]} is:`,
    code,
    'It expires in 10 minutes. If you did not ask for it, ignore this email.',
  ]);

export const alreadyRegisteredMail = (to: string, appUrl: string) =>
  mail(
    to,
    'You already have an account',
    [
      'Someone tried to create an account with this email, but you already have one.',
      'If it was you, log in, or reset your password if you forgot it.',
    ],
    { url: `${appUrl}/login`, label: 'Log in' },
  );

export const emailChangedMail = (to: string, newEmail: string) =>
  mail(to, 'Your login email was changed', [
    `The login email of your account was changed to ${newEmail}.`,
    'If you did not do this, contact your institute or support right away.',
  ]);

export const inviteMail = (
  to: string,
  i: { fullName: string; tenantName: string; role: string; url: string },
) =>
  mail(
    to,
    `Invitation to ${i.tenantName}`,
    [
      `Hello ${i.fullName},`,
      `You are invited to join ${i.tenantName} as ${i.role}.`,
      `Open the link and log in or create your account with this email (${to}). The link expires in 14 days.`,
    ],
    { url: i.url, label: 'Accept invitation' },
  );

export const accountReadyMail = (to: string, accountName: string, appUrl: string) =>
  mail(
    to,
    'Your institute account is ready',
    [
      `Your account "${accountName}" is ready.`,
      `Create your login with this email (${to}), then set up your institute.`,
    ],
    { url: `${appUrl}/signup?email=${encodeURIComponent(to)}`, label: 'Create your login' },
  );
