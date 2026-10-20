'use client';

import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Info,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { FormError, Skeleton, useToast } from '../ui';
import { Table, Td } from './shared';

// Platform documentation (GET /admin/docs, platform admins only). The content lives in
// apps/api/src/modules/platform/docs.ts; this file only renders it.

type Block =
  | { h2: string }
  | { h3: string }
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { code: string; title?: string }
  | { note: string; tone?: 'info' | 'warning' | 'danger' };
interface DocPage {
  slug: string;
  group: string;
  title: string;
  summary: string;
  blocks: Block[];
}

// One fetch per visit to the console: moving between pages reuses it.
let pagesPromise: Promise<DocPage[]> | null = null;
const loadPages = () =>
  (pagesPromise ??= api<{ pages: DocPage[] }>('/admin/docs')
    .then((r) => r.pages)
    .catch((err) => {
      pagesPromise = null;
      throw err;
    }));

const anchor = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const NOTE: Record<'info' | 'warning' | 'danger', [string, LucideIcon]> = {
  info: ['border-primary-ring bg-primary-soft/60', Info],
  warning: ['border-warning/30 bg-warning-soft', TriangleAlert],
  danger: ['border-danger/30 bg-danger-soft', CircleAlert],
};

/** `code`, **bold** and [text](href); "docs:<slug>" links open another docs page. */
function Inline({ text }: { text: string }) {
  const { lang } = useI18n();
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1)
      return (
        <code
          key={i}
          className="rounded bg-surface-soft px-1 py-0.5 font-mono text-[0.85em] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith('**') && part.endsWith('**'))
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link as unknown as [string, string, string];
      const cls = 'font-medium text-primary hover:text-primary-hover hover:underline';
      return href.startsWith('docs:') ? (
        <Link key={i} href={`/${lang}/admin/docs/${href.slice(5)}`} className={cls}>
          {label}
        </Link>
      ) : (
        <a key={i} href={href} className={cls}>
          {label}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-white/10 bg-ink px-3 py-1.5 text-xs text-white/70">
        <span className="flex-1 truncate">{title}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => toast(t.admin.docs.copied));
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
        >
          <Copy aria-hidden className="size-3.5" />
          {t.admin.docs.copy}
        </button>
      </div>
      <pre className="overflow-x-auto bg-ink p-3 font-mono text-[13px] leading-relaxed text-white/90">
        {code}
      </pre>
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((b, i) => {
    if ('h2' in b)
      return (
        <h2
          key={i}
          id={anchor(b.h2)}
          className="group scroll-mt-20 border-t border-line pt-6 text-xl font-semibold first:border-0 first:pt-0"
        >
          <a href={`#${anchor(b.h2)}`} className="hover:text-primary">
            {b.h2}
          </a>
        </h2>
      );
    if ('h3' in b)
      return (
        <h3 key={i} className="text-base font-semibold">
          {b.h3}
        </h3>
      );
    if ('p' in b)
      return (
        <p key={i} className="leading-relaxed text-ink-muted">
          <Inline text={b.p} />
        </p>
      );
    if ('list' in b)
      return (
        <ul key={i} className="list-disc space-y-1.5 pl-5 leading-relaxed text-ink-muted">
          {b.list.map((item, j) => (
            <li key={j}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    if ('steps' in b)
      return (
        <ol key={i} className="space-y-2">
          {b.steps.map((step, j) => (
            <li key={j} className="flex gap-3 leading-relaxed text-ink-muted">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-hover">
                {j + 1}
              </span>
              <span className="pt-0.5">
                <Inline text={step} />
              </span>
            </li>
          ))}
        </ol>
      );
    if ('table' in b)
      return (
        <Table key={i} head={b.table.head}>
          {b.table.rows.map((row, j) => (
            <tr key={j}>
              {row.map((cell, k) => (
                <Td key={k}>
                  <Inline text={cell} />
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      );
    if ('code' in b) return <CodeBlock key={i} code={b.code} title={b.title} />;
    const [cls, Icon] = NOTE[b.tone ?? 'info'];
    return (
      <div key={i} className={`flex gap-2.5 rounded-xl border p-3 text-sm ${cls}`}>
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="leading-relaxed">
          <Inline text={b.note} />
        </p>
      </div>
    );
  });
}

/** Sidebar: search, then the pages by group (or the search hits). */
function DocsNav({ pages, current }: { pages: DocPage[]; current: string }) {
  const { lang, t } = useI18n();
  const d = t.admin.docs;
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return pages.filter((p) => {
      const text = JSON.stringify(p).toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [pages, q]);
  const groups = [...new Set(pages.map((p) => p.group))];
  const item = (p: DocPage) => (
    <Link
      key={p.slug}
      href={`/${lang}/admin/docs/${p.slug}`}
      aria-current={p.slug === current ? 'page' : undefined}
      className={`block rounded-md px-2 py-1 text-sm transition-colors ${
        p.slug === current
          ? 'bg-primary-soft font-medium text-primary-hover'
          : 'text-ink-muted hover:bg-surface-soft hover:text-ink'
      }`}
    >
      {p.title}
    </Link>
  );
  return (
    <nav className="space-y-4">
      <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-ring">
        <Search aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={d.search}
          aria-label={d.search}
          className="w-full border-0 bg-transparent py-1.5 text-sm focus:shadow-none"
        />
      </label>
      {hits ? (
        hits.length ? (
          <div className="space-y-0.5">{hits.map(item)}</div>
        ) : (
          <p className="px-2 text-sm text-ink-subtle">{d.noResults}</p>
        )
      ) : (
        groups.map((g) => (
          <div key={g} className="space-y-0.5">
            <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              {g}
            </h3>
            {pages.filter((p) => p.group === g).map(item)}
          </div>
        ))
      )}
    </nav>
  );
}

export function DocsPage() {
  const { lang, t } = useI18n();
  const d = t.admin.docs;
  const { slug } = useParams<{ slug?: string }>();
  const [pages, setPages] = useState<DocPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPages()
      .then(setPages)
      .catch((err) => setError(errorMessage(t, err)));
  }, [t]);

  if (error) return <FormError message={error} />;
  if (!pages) return <Skeleton />;

  const index = Math.max(
    0,
    pages.findIndex((p) => p.slug === slug),
  );
  const page = pages[index]!;
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const toc = page.blocks.flatMap((b) => ('h2' in b ? [b.h2] : []));
  const pager = (p: DocPage | undefined, dir: 'prev' | 'next'): ReactNode =>
    p ? (
      <Link
        href={`/${lang}/admin/docs/${p.slug}`}
        className={`flex flex-1 flex-col rounded-xl border border-line p-3 text-sm transition-colors hover:border-primary-ring hover:bg-surface-soft ${dir === 'next' ? 'items-end text-right' : ''}`}
      >
        <span className="flex items-center gap-1 text-ink-subtle">
          {dir === 'prev' && <ChevronLeft aria-hidden className="size-4" />}
          {dir === 'prev' ? d.previous : d.next}
          {dir === 'next' && <ChevronRight aria-hidden className="size-4" />}
        </span>
        <span className="font-medium">{p.title}</span>
      </Link>
    ) : (
      <span className="flex-1" />
    );

  return (
    <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_13rem]">
      <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto">
        {/* Phones: the contents fold away above the page. */}
        <details className="rounded-xl border border-line bg-surface p-3 lg:hidden">
          <summary className="cursor-pointer text-sm font-medium">
            {d.contents}: {page.title}
          </summary>
          <div className="pt-3">
            <DocsNav pages={pages} current={page.slug} />
          </div>
        </details>
        <div className="hidden lg:block">
          <DocsNav pages={pages} current={page.slug} />
        </div>
      </aside>

      <article className="min-w-0 space-y-5">
        <header className="space-y-2">
          <p className="text-sm font-medium text-primary">{page.group}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
          <p className="text-lg text-ink-muted">{page.summary}</p>
        </header>
        <Blocks blocks={page.blocks} />
        <div className="flex gap-3 border-t border-line pt-6">
          {pager(prev, 'prev')}
          {pager(next, 'next')}
        </div>
      </article>

      {toc.length > 1 && (
        <aside className="hidden xl:sticky xl:top-6 xl:block xl:max-h-[calc(100dvh-8rem)] xl:self-start xl:overflow-y-auto">
          <h3 className="pb-2 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
            {d.onThisPage}
          </h3>
          <ul className="space-y-1 border-l border-line text-sm">
            {toc.map((h) => (
              <li key={h}>
                <a
                  href={`#${anchor(h)}`}
                  className="-ml-px block border-l border-transparent py-0.5 pl-3 text-ink-muted hover:border-primary hover:text-ink"
                >
                  {h.replace('/api/v1/admin', '')}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
