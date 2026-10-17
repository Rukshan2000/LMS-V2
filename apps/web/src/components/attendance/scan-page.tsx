'use client';

import {
  Camera,
  CameraOff,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  MessageCircle,
  ScanLine,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, errorMessage, fmt } from '@/lib/api';
import { colomboTime } from '@/lib/datetime';
import { fmtMoney } from '@/lib/money';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { btn, card } from '../ui';

interface ScanResult {
  student: { id: string; studentNumber: string; fullName: string };
  session: { id: string; batchName: string; subjectName: string; startsAt: string };
  attendance: { status: 'present' | 'late'; markedAt: string };
  duplicate: boolean;
  guardians: { fullName: string; phone: string }[];
  feeDue: string | null;
}
// `id` restarts the result animation on every scan, even a repeat of the same card.
type Outcome = { id: number } & (
  { ok: true; result: ScanResult } | { ok: false; message: string; name?: string }
);

// Minimal typing for the browser's built-in QR reader (Chrome on Android/desktop).
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

export function ScanPage() {
  const { t } = useI18n();
  const sc = t.scan;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { tenant } = useTenantData();
  const [code, setCode] = useState('');
  const [last, setLast] = useState<Outcome | null>(null);
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const [camera, setCamera] = useState<'off' | 'on' | 'unsupported'>('off');
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);

  const submit = useCallback(
    async (value: string) => {
      if (!value.trim() || busy.current) return;
      busy.current = true;
      try {
        const result = await api<ScanResult>(`/tenants/${tenantId}/attendance/scan`, {
          method: 'POST',
          body: { code: value.trim() },
        });
        setLast({ id: Date.now(), ok: true, result });
        if (!result.duplicate) setRecent((r) => [result, ...r].slice(0, 20));
      } catch (err) {
        const name =
          err instanceof ApiError
            ? (err.details as { student?: { fullName: string } })?.student?.fullName
            : undefined;
        setLast({ id: Date.now(), ok: false, message: errorMessage(t, err), name });
      }
      busy.current = false;
      setCode('');
      inputRef.current?.focus();
    },
    [tenantId, t],
  );

  // Camera scanning loop. Each code is ignored for 3 s after it is read (no repeat spam).
  useEffect(() => {
    if (camera !== 'on') return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const seen = new Map<string, number>();
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector!({ formats: ['qr_code'] });
      timer = setInterval(async () => {
        const found = await detector.detect(video).catch(() => []);
        const value = found[0]?.rawValue;
        if (value && Date.now() - (seen.get(value) ?? 0) > 3000) {
          seen.set(value, Date.now());
          void submit(value);
        }
      }, 300);
    })().catch(() => setCamera('unsupported'));
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camera, submit]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(code);
  }

  const message = (r: ScanResult) =>
    fmt(r.attendance.status === 'late' ? sc.lateMessage : sc.message, {
      student: r.student.fullName,
      class: r.session.batchName,
      time: colomboTime(r.attendance.markedAt),
      institute: tenant.name,
    });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{sc.title}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <form onSubmit={onSubmit} className="relative">
            {/* USB/Bluetooth barcode scanners type the code and press Enter. */}
            <ScanLine
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-primary"
            />
            <input
              ref={inputRef}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={sc.placeholder}
              aria-label={sc.placeholder}
              autoComplete="off"
              className="w-full rounded-xl border-2 border-primary-ring bg-surface py-3 pr-4 pl-13 text-lg shadow-card"
            />
          </form>
          <div>
            {camera === 'on' ? (
              <button
                type="button"
                onClick={() => setCamera('off')}
                className={btn('link', 'none')}
              >
                <CameraOff aria-hidden className="size-4" />
                {sc.stopCamera}
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setCamera(window.BarcodeDetector && navigator.mediaDevices ? 'on' : 'unsupported')
                }
                className={btn('secondary')}
              >
                <Camera aria-hidden className="size-4" />
                {sc.camera}
              </button>
            )}
            {camera === 'unsupported' && (
              <p className="mt-2 text-sm text-warning">{sc.cameraUnsupported}</p>
            )}
            {camera === 'on' && (
              <video
                ref={videoRef}
                muted
                playsInline
                className="mt-2 w-full animate-fade-in rounded-xl bg-black shadow-card"
              />
            )}
          </div>

          {last && (
            <div
              key={last.id}
              role="status"
              className={`flex animate-pop-in gap-4 rounded-2xl p-5 shadow-card ${
                !last.ok
                  ? 'bg-danger-soft text-danger'
                  : last.result.duplicate
                    ? 'bg-warning-soft text-warning'
                    : last.result.attendance.status === 'late'
                      ? 'bg-late-soft text-late'
                      : 'bg-success-soft text-success'
              }`}
            >
              {(() => {
                const Icon = !last.ok
                  ? CircleX
                  : last.result.duplicate
                    ? CircleAlert
                    : last.result.attendance.status === 'late'
                      ? Clock
                      : CircleCheck;
                return <Icon aria-hidden className="size-10 shrink-0" strokeWidth={1.75} />;
              })()}
              <div className="min-w-0 flex-1">
                {last.ok ? (
                  <>
                    <p className="text-2xl font-semibold">{last.result.student.fullName}</p>
                    <p>
                      {last.result.student.studentNumber} · {last.result.session.batchName} ·{' '}
                      {last.result.duplicate ? sc.already : sc[last.result.attendance.status]}
                    </p>
                    {last.result.feeDue && (
                      <p className="mt-2 rounded-lg bg-danger-soft px-3 py-1.5 font-medium text-danger">
                        {fmt(t.fees.feeDue, { amount: fmtMoney(last.result.feeDue) })}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {last.result.guardians.map((g) => (
                        <a
                          key={g.phone}
                          href={waLink(g.phone, message(last.result))}
                          target="_blank"
                          rel="noreferrer"
                          className={btn('whatsapp')}
                        >
                          <MessageCircle aria-hidden className="size-4" />
                          {fmt(sc.notifyParent, { name: g.fullName })}
                        </a>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {last.name && <p className="text-xl font-semibold">{last.name}</p>}
                    <p>{last.message}</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div>
          {recent.length > 0 && (
            <section className={`${card} overflow-hidden`}>
              <h2 className="border-b border-line bg-surface-soft px-4 py-2 text-sm font-medium">
                {sc.recent}
              </h2>
              <ul className="divide-y divide-line text-sm">
                {recent.map((r) => (
                  <li
                    key={`${r.student.id}-${r.session.id}`}
                    className="flex animate-fade-in gap-3 px-4 py-2"
                  >
                    <span className="font-mono text-ink-subtle">
                      {colomboTime(r.attendance.markedAt)}
                    </span>
                    <span className="flex-1">{r.student.fullName}</span>
                    <span className="text-ink-subtle">{r.session.batchName}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
