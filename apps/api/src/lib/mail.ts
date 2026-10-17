import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

/** Gmail (or any SMTP server). Port 587 = STARTTLS, 465 = TLS. */
export function smtpMailer(cfg: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.password },
    pool: true,
  });
  const from = { name: cfg.fromName, address: cfg.fromEmail };
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}

/** Keeps every mail in `sent` (tests read OTPs from it); `log` prints them in local dev. */
export function memoryMailer(log?: (mail: Mail) => void) {
  const sent: Mail[] = [];
  return {
    sent,
    async send(mail: Mail) {
      sent.push(mail);
      log?.(mail);
    },
  } satisfies Mailer & { sent: Mail[] };
}
