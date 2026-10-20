import {
  ArrowUpRight,
  Clock,
  LogIn,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Quote,
  Sparkle,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type CSSProperties } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { displayPhone } from '@/components/students/types';
import { btn } from '@/components/styles';
import { isLocale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries/en';
import { getDictionary } from '@/i18n/get-dictionary';
import { fmt } from '@/lib/api';
import { weekdayName } from '@/lib/datetime';
import { getInstitutePage, type InstitutePage as Data } from '@/lib/institute-page';
import { fmtMoney } from '@/lib/money';

// An institute's public web page, styled like a night-class poster: a dark hero lit by the
// institute's theme colour, session cards pinned to it, class "tickets" and a weekly timetable.
// Data is cached per institute (lib/institute-page.ts) and refreshed when the owner saves.

const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
});

// Film grain and a faint grid for the dark hero (inline, so no extra requests).
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const GRID: CSSProperties = {
  backgroundImage:
    'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
  backgroundSize: '56px 56px',
  maskImage: 'radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)',
};
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export async function generateMetadata({
  params,
}: PageProps<'/[lang]/i/[slug]'>): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const data = await getInstitutePage(slug);
  if (!data) return { title: (await getDictionary(lang)).site.notFound, robots: { index: false } };
  const { institute, page } = data;
  const description = (page.tagline ?? page.about ?? institute.name).slice(0, 160);
  return {
    title: page.tagline ? `${institute.name} | ${page.tagline}` : institute.name,
    description,
    openGraph: { title: institute.name, description, type: 'website' },
    alternates: { canonical: `/${lang}/i/${slug}` },
  };
}

export default function Page(props: PageProps<'/[lang]/i/[slug]'>) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ink" />}>
      <InstitutePage {...props} />
    </Suspense>
  );
}

async function InstitutePage({ params }: PageProps<'/[lang]/i/[slug]'>) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const [t, data] = await Promise.all([getDictionary(lang), getInstitutePage(slug)]);
  if (!data) notFound();
  const { institute, page, classes } = data;
  const s = t.site;

  const whatsapp =
    page.whatsapp &&
    `https://wa.me/${page.whatsapp}?text=${encodeURIComponent(fmt(s.enquiry, { institute: institute.name }))}`;
  const subjects = [...new Set(classes.map((c) => c.subject))];
  const sessions = classes
    .flatMap((c) => c.schedule.map((r) => ({ ...r, subject: c.subject, name: c.name })))
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const hours = Math.round(
    sessions.reduce((sum, r) => sum + minutes(r.endTime) - minutes(r.startTime), 0) / 60,
  );
  const words = institute.name.trim().split(/\s+/);
  const lastWord = words.length > 1 ? words.pop() : undefined;

  return (
    <main
      data-theme={institute.theme}
      className={`${display.variable} flex flex-1 flex-col bg-canvas`}
    >
      {/* ───────────── Hero ───────────── */}
      <section className="relative isolate overflow-hidden bg-ink text-white">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-primary opacity-50 blur-[120px]" />
          <div className="absolute -bottom-48 right-[-10rem] size-[30rem] rounded-full bg-primary-ring opacity-25 blur-[120px]" />
          <div className="absolute inset-0" style={GRID} />
          <div
            className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
            style={{ backgroundImage: GRAIN }}
          />
        </div>

        <nav className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
          <span className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="font-display flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl italic shadow-lg shadow-primary/40"
            >
              {institute.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="truncate font-semibold tracking-tight">{institute.name}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2 text-ink">
            <LanguageSwitcher />
            <Link
              href={`/${lang}/login`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
            >
              <LogIn aria-hidden className="size-4" />
              <span className="hidden sm:inline">{s.login}</span>
            </Link>
          </div>
        </nav>

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-10 sm:px-8 lg:grid-cols-[1.25fr_1fr] lg:pb-32 lg:pt-16">
          <div className="space-y-8">
            {subjects.length > 0 && (
              <p
                className="flex animate-rise flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium uppercase tracking-[0.2em] text-primary-ring"
                style={delay(0)}
              >
                {subjects.map((name, i) => (
                  <span key={name} className="flex items-center gap-3">
                    {i > 0 && <Sparkle aria-hidden className="size-3 fill-current" />}
                    {name}
                  </span>
                ))}
              </p>
            )}
            <h1
              className="font-display animate-rise text-5xl font-semibold leading-[0.95] tracking-tight break-words sm:text-7xl lg:text-8xl"
              style={delay(80)}
            >
              {words.join(' ')}{' '}
              {lastWord && <em className="font-normal text-primary-ring">{lastWord}</em>}
            </h1>
            {page.tagline && (
              <p
                className="max-w-xl animate-rise text-lg text-white/70 sm:text-xl"
                style={delay(160)}
              >
                {page.tagline}
              </p>
            )}
            {(whatsapp || page.phone) && (
              <div className="flex animate-rise flex-col gap-3 sm:flex-row" style={delay(240)}>
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener"
                    className={`${btn('whatsapp', 'md')} px-6 py-3.5 text-base shadow-lg shadow-success-solid/30`}
                  >
                    <MessageCircle aria-hidden className="size-5" />
                    {s.whatsapp}
                  </a>
                )}
                {page.phone && (
                  <a
                    href={`tel:+${page.phone}`}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3.5 font-medium backdrop-blur transition hover:bg-white/15"
                  >
                    <Phone aria-hidden className="size-5" />
                    {displayPhone(page.phone)}
                  </a>
                )}
              </div>
            )}
            {classes.length > 0 && (
              <dl className="flex animate-rise flex-wrap gap-x-10 gap-y-4 pt-2" style={delay(320)}>
                {[
                  [classes.length, s.statClasses],
                  [subjects.length, s.statSubjects],
                  ...(hours > 0 ? [[hours, s.statHours] as const] : []),
                ].map(([value, label]) => (
                  <div key={label} className="border-l-2 border-primary pl-4">
                    <dt className="text-xs uppercase tracking-wider text-white/50">{label}</dt>
                    <dd className="font-display text-4xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <SessionCollage sessions={sessions.slice(0, 3)} t={t} />
        </div>
      </section>

      {/* ───────────── Subject ticker ───────────── */}
      {subjects.length > 0 && (
        <div aria-hidden className="overflow-hidden bg-primary py-4 text-white">
          <div className="flex w-max animate-marquee">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center">
                {Array.from({ length: 6 }, () => subjects)
                  .flat()
                  .map((name, i) => (
                    <span
                      key={i}
                      className="font-display flex items-center gap-6 px-6 text-2xl italic"
                    >
                      {name}
                      <Sparkle className="size-4 fill-current opacity-70" />
                    </span>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───────────── Classes ───────────── */}
      <section className="px-4 py-24 sm:px-8">
        <div className="mx-auto max-w-6xl space-y-12">
          <SectionTitle n="01" title={s.classes} />
          {classes.length === 0 ? (
            <p className="text-ink-subtle">{s.noClasses}</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {classes.map((c, i) => (
                <ClassTicket key={i} c={c} t={t} style={delay(i * 90)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ───────────── Weekly timetable ───────────── */}
      {sessions.length > 0 && (
        <section className="bg-surface-soft px-4 py-24 sm:px-8">
          <div className="mx-auto max-w-6xl space-y-12">
            <SectionTitle n="02" title={s.weekTitle} hint={s.weekHint} />
            <div className="grid gap-3 lg:grid-cols-7">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const today = sessions.filter((r) => r.weekday === day);
                return (
                  <div
                    key={day}
                    className={`rounded-2xl p-3 ${today.length ? 'bg-surface shadow-card' : 'hidden border border-dashed border-line-strong lg:block'}`}
                  >
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                      {weekdayName(day, t.calendar)}
                    </p>
                    <div className="space-y-2">
                      {today.map((r, i) => (
                        <div
                          key={i}
                          className="rounded-xl border-l-4 border-primary bg-primary-soft/70 p-2.5"
                        >
                          <p className="text-xs font-semibold text-primary-hover">
                            {r.startTime}–{r.endTime}
                          </p>
                          <p className="text-sm font-medium leading-snug">{r.subject}</p>
                          <p className="text-xs text-ink-muted">{r.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ───────────── About ───────────── */}
      {page.about && (
        <section className="relative overflow-hidden px-4 py-24 sm:px-8">
          <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-6">
              <SectionTitle n={sessions.length ? '03' : '02'} title={s.about} />
              <Quote aria-hidden className="size-16 fill-primary-soft text-primary" />
            </div>
            <p className="font-display whitespace-pre-line border-l-4 border-primary-soft pl-6 text-2xl leading-relaxed text-ink sm:pl-10 sm:text-3xl">
              {page.about}
            </p>
          </div>
        </section>
      )}

      {/* ───────────── Contact ───────────── */}
      <section className="px-4 pb-24 sm:px-8">
        <div className="mx-auto grid max-w-6xl overflow-hidden rounded-[2rem] bg-ink text-white shadow-raised lg:grid-cols-2">
          <div className="space-y-6 p-8 sm:p-12">
            <h2 className="font-display text-4xl font-semibold">{s.contact}</h2>
            <ul className="space-y-4 text-white/80">
              {page.address && (
                <li className="flex gap-3">
                  <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-primary-ring" />
                  <span>
                    {page.address}
                    {page.mapUrl && (
                      <a
                        href={page.mapUrl}
                        target="_blank"
                        rel="noopener nofollow"
                        className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary-ring underline-offset-4 hover:underline"
                      >
                        {s.directions}
                        <ArrowUpRight aria-hidden className="size-4" />
                      </a>
                    )}
                  </span>
                </li>
              )}
              {page.phone && (
                <li className="flex gap-3">
                  <Phone aria-hidden className="size-5 shrink-0 text-primary-ring" />
                  <a href={`tel:+${page.phone}`} className="hover:text-white">
                    {displayPhone(page.phone)}
                  </a>
                </li>
              )}
              {page.email && (
                <li className="flex gap-3">
                  <Mail aria-hidden className="size-5 shrink-0 text-primary-ring" />
                  <a href={`mailto:${page.email}`} className="break-all hover:text-white">
                    {page.email}
                  </a>
                </li>
              )}
            </ul>
            <Socials page={page} />
          </div>
          <div className="relative flex flex-col justify-end gap-6 overflow-hidden bg-linear-to-br from-primary to-primary-hover p-8 sm:p-12">
            <MessageCircle
              aria-hidden
              className="absolute -right-10 -top-10 size-64 text-white/10"
            />
            <h3 className="font-display relative text-3xl font-semibold leading-tight sm:text-4xl">
              {s.enquireTitle}
            </h3>
            <p className="relative max-w-sm text-white/80">{s.enquireBody}</p>
            {whatsapp ? (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener"
                className="relative inline-flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3.5 font-semibold text-primary-hover shadow-lg transition hover:-translate-y-0.5"
              >
                <MessageCircle aria-hidden className="size-5" />
                {s.whatsapp}
              </a>
            ) : (
              page.phone && (
                <a
                  href={`tel:+${page.phone}`}
                  className="relative inline-flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3.5 font-semibold text-primary-hover"
                >
                  <Phone aria-hidden className="size-5" />
                  {s.call}
                </a>
              )
            )}
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-line px-4 py-8 text-center text-sm text-ink-subtle">
        <Link href={`/${lang}`} className="hover:text-ink">
          {fmt(s.madeWith, { app: t.appName })}
        </Link>
      </footer>
    </main>
  );
}

function SectionTitle({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-3 text-sm font-semibold tracking-[0.2em] text-primary">
        {n}
        <span aria-hidden className="h-px w-12 bg-primary" />
      </p>
      <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h2>
      {hint && <p className="text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Up to three sessions as cards pinned at angles beside the hero heading. */
function SessionCollage({
  sessions,
  t,
}: {
  sessions: (Data['classes'][number]['schedule'][number] & { subject: string; name: string })[];
  t: Dictionary;
}) {
  if (!sessions.length) return null;
  const tilt = [
    '-rotate-6 lg:translate-x-6',
    'rotate-3 lg:-translate-x-4',
    '-rotate-2 lg:translate-x-10',
  ];
  return (
    <div aria-hidden className="relative mx-auto hidden w-full max-w-sm sm:block">
      {sessions.map((r, i) => (
        <div key={i} className={`animate-rise ${i ? '-mt-6' : ''}`} style={delay(300 + i * 120)}>
          <div
            className={`${tilt[i]} relative rounded-2xl bg-surface p-5 text-ink shadow-2xl shadow-black/40 ring-1 ring-black/5 transition duration-300 hover:rotate-0`}
          >
            <span className="absolute -top-2 left-1/2 size-4 -translate-x-1/2 rounded-full bg-primary shadow ring-4 ring-ink" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-2xl font-semibold italic">
                  {weekdayName(r.weekday, t.calendar)}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <Clock className="size-3.5" />
                  {r.startTime}–{r.endTime}
                </p>
              </div>
              <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-hover">
                {r.subject}
              </span>
            </div>
            <p className="mt-3 border-t border-dashed border-line pt-3 text-sm font-medium">
              {r.name}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A class as a perforated ticket: subject band, week strip, times and fees. */
function ClassTicket({
  c,
  t,
  style,
}: {
  c: Data['classes'][number];
  t: Dictionary;
  style: CSSProperties;
}) {
  const s = t.site;
  const days = new Set(c.schedule.map((r) => r.weekday));
  return (
    <article
      style={style}
      className="group relative flex animate-rise flex-col rounded-3xl border border-line bg-surface shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-raised"
    >
      <div className="relative overflow-hidden rounded-t-3xl bg-linear-to-br from-primary to-primary-hover px-6 pb-6 pt-5 text-white">
        <span
          aria-hidden
          className="font-display absolute -bottom-8 -right-2 text-[7rem] leading-none italic text-white/10 transition duration-500 group-hover:scale-110"
        >
          {c.subject.charAt(0)}
        </span>
        <div className="relative flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>{c.subject}</span>
          <span className="rounded-full bg-white/20 px-2.5 py-1 normal-case tracking-normal">
            {t.classes[c.mode]}
          </span>
        </div>
        <h3 className="font-display relative mt-3 text-2xl font-semibold leading-tight">
          {c.name}
        </h3>
        {c.teacherName && (
          <p className="relative mt-1 flex items-center gap-1.5 text-sm text-white/80">
            <UserRound aria-hidden className="size-4" />
            {fmt(s.teacher, { name: c.teacherName })}
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex justify-between" aria-hidden>
          {s.days.map((d, i) => (
            <span
              key={i}
              className={`flex size-8 items-center justify-center rounded-full text-xs font-semibold ${
                days.has(i + 1)
                  ? 'bg-primary text-white shadow-md shadow-primary/30'
                  : 'bg-neutral-soft text-ink-subtle'
              }`}
            >
              {d}
            </span>
          ))}
        </div>
        {c.schedule.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {c.schedule.map((r, j) => (
              <li key={j} className="flex justify-between gap-3">
                <span className="font-medium">{weekdayName(r.weekday, t.calendar)}</span>
                <span className="tabular-nums text-ink-muted">
                  {r.startTime}–{r.endTime}
                </span>
              </li>
            ))}
          </ul>
        )}

        {c.fees.length > 0 && (
          <>
            {/* Perforation: dashed line with notches cut into both edges. */}
            <div aria-hidden className="relative -mx-6 my-1 border-t-2 border-dashed border-line">
              <span className="absolute -left-3 -top-3 size-6 rounded-full border border-line bg-canvas" />
              <span className="absolute -right-3 -top-3 size-6 rounded-full border border-line bg-canvas" />
            </div>
            <dl className="mt-auto space-y-1">
              {c.fees.map((f) => (
                <div key={f.kind} className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-ink-muted">{t.fees.kinds[f.kind]}</dt>
                  <dd>
                    <span className="text-xs text-ink-subtle">LKR </span>
                    <span className="font-display text-2xl font-semibold tabular-nums">
                      {fmtMoney(f.amount).replace(/\.00$/, '')}
                    </span>
                    <span className="text-xs text-ink-subtle"> {s.perMonth}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </article>
  );
}

function Socials({ page }: { page: Data['page'] }) {
  const links = [
    ['Facebook', page.facebookUrl],
    ['YouTube', page.youtubeUrl],
    ['TikTok', page.tiktokUrl],
  ].filter((x): x is [string, string] => !!x[1]);
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {links.map(([name, url]) => (
        <a
          key={name}
          href={url}
          target="_blank"
          rel="noopener nofollow"
          className="inline-flex items-center gap-1 rounded-full border border-white/20 px-4 py-1.5 text-sm transition hover:bg-white/10"
        >
          {name}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      ))}
    </div>
  );
}
