import type { Metadata } from 'next';
import { Noto_Sans, Noto_Sans_Sinhala, Noto_Sans_Tamil } from 'next/font/google';
import { notFound } from 'next/navigation';
import { isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/get-dictionary';
import { I18nProvider } from '@/i18n/provider';
import '../globals.css';

const latin = Noto_Sans({ subsets: ['latin'], variable: '--font-latin' });
const sinhala = Noto_Sans_Sinhala({ subsets: ['sinhala'], variable: '--font-sinhala' });
const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], variable: '--font-tamil' });

export const generateStaticParams = () => locales.map((lang) => ({ lang }));

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = await getDictionary(lang);
  return { title: t.appName, description: t.landing.sub };
}

export default async function RootLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <html
      lang={lang}
      className={`${latin.variable} ${sinhala.variable} ${tamil.variable} h-full antialiased`}
    >
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body>
          before React loads; this ignores attribute differences on this element only. */}
      <body className="flex min-h-full flex-col font-sans" suppressHydrationWarning>
        <I18nProvider lang={lang} dict={dict}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
