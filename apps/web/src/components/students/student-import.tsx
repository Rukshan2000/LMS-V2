'use client';

import { CircleAlert, CircleCheck, Download, FileUp, SkipForward } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, errorMessage, fmt } from '@/lib/api';
import { BackLink, btn, Button, card, FormError, FormSuccess } from '../ui';

interface Issue {
  line: number;
  field?: string;
  code: string;
  message: string;
}
interface Result {
  total: number;
  ready: number;
  skipped: Issue[];
  errors: Issue[];
  created: number;
}

// UTF-8 BOM so Excel opens Sinhala/Tamil text correctly.
const TEMPLATE =
  '\uFEFFName,Grade,School,Phone,Guardian Name,Guardian Phone,Relationship\r\n' +
  'Kasun Perera,2027 A/L,Royal College,,Nimali Perera,0771234567,mother\r\n';

export function StudentImport() {
  const { lang, t } = useI18n();
  const s = t.students;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    if (csv === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ result: Result }>(
        `/tenants/${tenantId}/students/import?dryRun=${dryRun}`,
        { method: 'POST', csv },
      );
      setResult(res.result);
    } catch (err) {
      // A file with invalid rows comes back as 400 with the per-line report.
      const report =
        err instanceof ApiError ? (err.body as { result?: Result })?.result : undefined;
      if (report) setResult(report);
      else setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setCsv(file ? await file.text() : null);
  }

  const issueText = (i: Issue) =>
    (s.issues as Record<string, string>)[i.code] ??
    (s.issues as Record<string, string>)[i.message] ??
    `${i.field ? `${i.field}: ` : ''}${s.invalidValue}`;

  return (
    <div className="space-y-4">
      <BackLink href={`/${lang}/t/${tenantId}/students`}>{s.back}</BackLink>
      <h1 className="text-2xl font-semibold">{s.importTitle}</h1>
      <p className="text-ink-muted">{s.importHelp}</p>
      <a
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
        download="students-template.csv"
        className={btn('link', 'none')}
      >
        <Download aria-hidden className="size-4" />
        {s.template}
      </a>

      <label className="block cursor-pointer rounded-xl border-2 border-dashed border-line-strong bg-surface p-5 transition-colors hover:border-primary-ring hover:bg-surface-soft">
        <span className="mb-3 flex items-center gap-2 text-sm font-medium">
          <FileUp aria-hidden className="size-5 text-primary" />
          {s.chooseFile}
        </span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {csv !== null && !result?.created && (
        <div>
          <Button type="button" full={false} busy={busy} onClick={() => run(true)}>
            {s.preview}
          </Button>
        </div>
      )}
      <FormError message={error} />

      {result && (
        <div className={`${card} animate-fade-in space-y-3 p-4`}>
          {result.created > 0 ? (
            <FormSuccess>{fmt(s.imported, { count: result.created })}</FormSuccess>
          ) : (
            <ul className="space-y-1 text-sm">
              <li className="flex items-center gap-2 text-success">
                <CircleCheck aria-hidden className="size-4" />
                {fmt(s.summaryReady, { count: result.ready })}
              </li>
              {result.skipped.length > 0 && (
                <li className="flex items-center gap-2 text-ink-muted">
                  <SkipForward aria-hidden className="size-4" />
                  {fmt(s.summarySkipped, { count: result.skipped.length })}
                </li>
              )}
              {result.errors.length > 0 && (
                <li className="flex items-center gap-2 text-danger">
                  <CircleAlert aria-hidden className="size-4" />
                  {fmt(s.summaryErrors, { count: result.errors.length })}
                </li>
              )}
            </ul>
          )}
          {[...result.errors, ...result.skipped].length > 0 && (
            <ul className="max-h-64 space-y-0.5 overflow-auto rounded-lg bg-surface-soft p-3 text-sm">
              {[...result.errors, ...result.skipped]
                .sort((a, b) => a.line - b.line)
                .map((i, n) => (
                  <li key={n} className={i.code === 'invalid' ? 'text-danger' : 'text-ink-muted'}>
                    {s.line} {i.line}:{' '}
                    {i.code === 'invalid' ? issueText(i) : `${i.message} — ${issueText(i)}`}
                  </li>
                ))}
            </ul>
          )}
          {result.created === 0 && result.errors.length === 0 && result.ready > 0 && (
            <div>
              <Button type="button" full={false} busy={busy} onClick={() => run(false)}>
                {fmt(s.importNow, { count: result.ready })}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
