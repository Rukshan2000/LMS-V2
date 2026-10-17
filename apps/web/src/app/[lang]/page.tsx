import { ClipboardCheck, LogIn, MessageCircle, UserPlus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { btn } from '@/components/styles';
import { Brand } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/get-dictionary';

export default async function Landing({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getDictionary(lang);

  return (
    <main className="flex flex-1 flex-col bg-linear-to-b from-canvas via-canvas to-accent-sky/60">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Brand />
        <LanguageSwitcher />
      </header>
      <section className="mx-auto flex max-w-2xl flex-1 animate-fade-in flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <div aria-hidden className="flex gap-3 text-primary">
          {[ClipboardCheck, Wallet, MessageCircle].map((Icon, i) => (
            <span
              key={i}
              className="flex size-12 items-center justify-center rounded-2xl border border-line bg-surface shadow-card"
            >
              <Icon className="size-6" />
            </span>
          ))}
        </div>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{t.landing.headline}</h1>
        <p className="text-lg text-ink-muted">{t.landing.sub}</p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href={`/${lang}/signup`} className={`${btn('primary', 'md')} px-6 py-3`}>
            <UserPlus aria-hidden className="size-5" />
            {t.landing.signup}
          </Link>
          <Link href={`/${lang}/login`} className={`${btn('secondary', 'md')} px-6 py-3`}>
            <LogIn aria-hidden className="size-5" />
            {t.landing.login}
          </Link>
        </div>
      </section>
    </main>
  );
}
