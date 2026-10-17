import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { card } from '@/components/styles';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/get-dictionary';

export default async function Privacy({ params }: PageProps<'/[lang]/privacy'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getDictionary(lang);
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ShieldCheck aria-hidden className="size-7 text-primary" />
          {t.privacy.title}
        </h1>
        <LanguageSwitcher />
      </div>
      <p className="text-ink-muted">{t.privacy.intro}</p>
      {t.privacy.sections.map((s) => (
        <section key={s.heading} className={`${card} space-y-1 p-4`}>
          <h2 className="font-medium">{s.heading}</h2>
          <p className="text-ink-muted">{s.body}</p>
        </section>
      ))}
    </main>
  );
}
