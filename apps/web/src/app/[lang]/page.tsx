import {
  ArrowRight,
  CalendarDays,
  ChartColumn,
  Check,
  ListChecks,
  LogIn,
  MessageCircle,
  QrCode,
  ReceiptText,
  ScanLine,
  UsersRound,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { btn, card } from '@/components/styles';
import { Brand } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries/en';
import { getDictionary } from '@/i18n/get-dictionary';

// Same order as t.landing.features.
const featureIcons = [
  QrCode,
  Wallet,
  ReceiptText,
  MessageCircle,
  CalendarDays,
  ListChecks,
  UsersRound,
  ChartColumn,
];

export default async function Landing({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getDictionary(lang);
  const l = t.landing;

  const login = (
    <Link href={`/${lang}/login`} className={`${btn('primary', 'md')} px-6 py-3`}>
      <LogIn aria-hidden className="size-5" />
      {l.login}
    </Link>
  );

  return (
    <main className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line/70 bg-canvas/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <Brand />
          <div className="hidden gap-6 text-sm text-ink-muted md:flex">
            <a href="#features" className="hover:text-ink">
              {l.nav.features}
            </a>
            <a href="#how" className="hover:text-ink">
              {l.nav.how}
            </a>
            <a href="#pricing" className="hover:text-ink">
              {l.nav.pricing}
            </a>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href={`/${lang}/login`} className={btn('secondary', 'sm')}>
              {l.login}
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="bg-linear-to-b from-canvas via-canvas to-accent-sky/60">
        <div className="mx-auto grid max-w-6xl animate-fade-in items-center gap-12 px-4 py-16 sm:px-8 lg:grid-cols-2 lg:py-24">
          <div className="space-y-6 text-center lg:text-left">
            <span className="inline-flex rounded-full border border-primary-ring bg-primary-soft px-3 py-1 text-sm font-medium text-primary">
              {l.badge}
            </span>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">{l.headline}</h1>
            <p className="text-lg text-ink-muted">{l.sub}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              {login}
              <a href="#features" className={`${btn('secondary', 'md')} px-6 py-3`}>
                {l.explore}
                <ArrowRight aria-hidden className="size-5" />
              </a>
            </div>
          </div>
          <HeroMock m={l.mock} />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16 px-4 py-20 sm:px-8">
        <div className="mx-auto max-w-6xl space-y-12">
          <div className="mx-auto max-w-2xl space-y-3 text-center">
            <h2 className="text-3xl font-bold">{l.featuresTitle}</h2>
            <p className="text-ink-muted">{l.featuresSub}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {l.features.map((f, i) => {
              const Icon = featureIcons[i];
              return (
                <div
                  key={f.title}
                  className={`${card} space-y-3 p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-raised`}
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon aria-hidden className="size-6" />
                  </span>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-sm text-ink-muted">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 bg-surface-soft px-4 py-20 sm:px-8">
        <div className="mx-auto max-w-5xl space-y-12">
          <h2 className="text-center text-3xl font-bold">{l.howTitle}</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {l.steps.map((s, i) => (
              <li key={s.title} className={`${card} space-y-2 p-6`}>
                <span className="flex size-9 items-center justify-center rounded-full bg-primary font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="pt-2 font-semibold">{s.title}</h3>
                <p className="text-sm text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 px-4 py-20 sm:px-8">
        <div className={`${card} mx-auto max-w-3xl space-y-6 p-8 text-center shadow-card sm:p-12`}>
          <h2 className="text-3xl font-bold">{l.pricingTitle}</h2>
          <p className="text-lg text-ink-muted">{l.pricingBody}</p>
          <ul className="grid gap-3 text-left sm:grid-cols-2">
            {l.pricingPoints.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check aria-hidden className="size-5 shrink-0 text-success-solid" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Call to action */}
      <section className="px-4 pb-20 sm:px-8">
        <div className="mx-auto max-w-6xl space-y-6 rounded-2xl bg-linear-to-br from-primary to-primary-hover px-6 py-14 text-center text-white sm:px-12">
          <h2 className="text-3xl font-bold">{l.ctaTitle}</h2>
          <p className="mx-auto max-w-xl text-white/85">{l.ctaBody}</p>
          <Link
            href={`/${lang}/login`}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-medium text-primary transition hover:bg-primary-soft"
          >
            <LogIn aria-hidden className="size-5" />
            {l.login}
          </Link>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-8 text-sm text-ink-subtle sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <span>
            © {t.appName}. {l.footer}
          </span>
          <Link href={`/${lang}/privacy`} className="hover:text-ink">
            {t.privacy.title}
          </Link>
        </div>
      </footer>
    </main>
  );
}

/** A static picture of the app (scan screen + slip approval), built from the same tokens. */
function HeroMock({ m }: { m: Dictionary['landing']['mock'] }) {
  const scans = [
    { name: 'Kasun Perera', time: '4:02 PM', paid: true },
    { name: 'Nimali Silva', time: '4:03 PM', paid: true },
    { name: 'Tharindu Fernando', time: '4:05 PM', paid: false },
  ];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md select-none">
      <div className={`${card} space-y-4 p-5 shadow-raised`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">{m.batch}</p>
            <p className="text-sm text-ink-subtle">{m.today}</p>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white">
            <ScanLine className="size-5" />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-success-soft p-3">
            <p className="text-xs text-success">{m.present}</p>
            <p className="text-2xl font-bold text-success">128 / 140</p>
          </div>
          <div className="rounded-lg bg-primary-soft p-3">
            <p className="text-xs text-primary">{m.collected}</p>
            <p className="text-2xl font-bold text-primary">LKR 412k</p>
          </div>
        </div>
        <ul className="divide-y divide-line">
          {scans.map((s) => (
            <li key={s.name} className="flex items-center justify-between py-2.5 text-sm">
              <span>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-ink-subtle">{s.time}</span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.paid ? 'bg-success-soft text-success' : 'bg-late-soft text-late'
                }`}
              >
                {s.paid ? m.paid : m.due}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div
        className={`${card} absolute -bottom-10 -left-4 hidden items-center gap-3 p-3 shadow-raised sm:flex`}
      >
        <ReceiptText className="size-5 text-primary" />
        <span className="text-sm">{m.slip}</span>
        <span className="rounded-md bg-success-solid px-2 py-1 text-xs font-medium text-white">
          {m.approve}
        </span>
      </div>
    </div>
  );
}
