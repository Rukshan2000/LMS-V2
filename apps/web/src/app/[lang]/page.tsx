import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/get-dictionary';

export default async function Landing({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getDictionary(lang);

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <span className="font-semibold">{t.appName}</span>
        <LanguageSwitcher />
      </header>
      <section className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{t.landing.headline}</h1>
        <p className="text-lg text-zinc-600">{t.landing.sub}</p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href={`/${lang}/signup`}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700"
          >
            {t.landing.signup}
          </Link>
          <Link
            href={`/${lang}/login`}
            className="rounded-lg border border-zinc-300 bg-white px-6 py-3 font-medium hover:bg-zinc-50"
          >
            {t.landing.login}
          </Link>
        </div>
      </section>
    </main>
  );
}
