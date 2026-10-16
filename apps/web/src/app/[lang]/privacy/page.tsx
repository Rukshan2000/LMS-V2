import { notFound } from 'next/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/get-dictionary';

export default async function Privacy({ params }: PageProps<'/[lang]/privacy'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getDictionary(lang);
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t.privacy.title}</h1>
        <LanguageSwitcher />
      </div>
      <p className="text-zinc-700">{t.privacy.intro}</p>
      {t.privacy.sections.map((s) => (
        <section key={s.heading} className="space-y-1">
          <h2 className="font-medium">{s.heading}</h2>
          <p className="text-zinc-700">{s.body}</p>
        </section>
      ))}
    </main>
  );
}
