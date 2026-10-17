'use client';

import {
  Ban,
  ChevronLeft,
  GraduationCap,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Hourglass,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { useI18n } from '@/i18n/provider';
import { btn, card, type Size, type Variant } from './styles';

export { btn, card, type Size, type Variant };

/** Logo mark + app name. */
export function Brand() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
        <GraduationCap aria-hidden className="size-5" />
      </span>
      {t.appName}
    </span>
  );
}

/** "← Section" link at the top of a sub-page. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
    >
      <ChevronLeft
        aria-hidden
        className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
      />
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-muted">
        {label}
      </label>
      <input
        {...input}
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base read-only:bg-surface-soft"
      />
      {hint && (
        <span id={`${id}-hint`} className="mt-1 block text-xs text-ink-subtle">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Button({
  children,
  busy,
  variant = 'primary',
  size = 'md',
  full = true,
  icon: Icon,
  ...props
}: {
  busy?: boolean;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      className={btn(variant, size, full)}
    >
      {busy ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : (
        Icon && <Icon aria-hidden className="size-4" />
      )}
      {children}
    </button>
  );
}

/** Removals and other hard-to-undo actions: first tap arms, second tap runs (disarms after 4 s). */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  icon: Icon,
}: {
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  icon?: LucideIcon;
}) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return armed ? (
    <button
      type="button"
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
      className={`${btn('danger', 'xs')} animate-pop-in`}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {confirmLabel ?? t.confirm}
    </button>
  ) : (
    <button type="button" onClick={() => setArmed(true)} className={btn('linkDanger', 'none')}>
      {Icon && <Icon aria-hidden className="size-4" />}
      {children}
    </button>
  );
}

const tones = {
  success: 'bg-success-soft text-success',
  late: 'bg-late-soft text-late',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-neutral-soft text-ink-subtle',
  primary: 'bg-primary-soft text-primary-hover',
};
export type Tone = keyof typeof tones;

/** Fixed colour and icon per status, used across the app. */
const STATUS: Record<string, [Tone, LucideIcon]> = {
  present: ['success', CircleCheck],
  late: ['late', Clock],
  absent: ['danger', CircleX],
  paid: ['success', CircleCheck],
  part_paid: ['warning', CircleDashed],
  issued: ['danger', CircleAlert],
  void: ['neutral', Ban],
  pending: ['warning', Hourglass],
  verified: ['success', CircleCheck],
  rejected: ['danger', CircleX],
  cancelled: ['danger', CircleX],
};

/** Status pill: always icon + word, never colour alone. */
export function Badge({
  status,
  tone,
  children,
}: {
  status?: string;
  tone?: Tone;
  children: ReactNode;
}) {
  const [statusTone, Icon] = (status && STATUS[status]) || [tone ?? 'neutral', null];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-200 ${tones[tone ?? statusTone]}`}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex animate-fade-in items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex animate-fade-in items-start gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success"
    >
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-sm animate-pop-in rounded-2xl border border-line bg-surface p-6 shadow-raised">
      {children}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center gap-2 p-10 text-ink-subtle"
    >
      <LoaderCircle aria-hidden className="size-5 animate-spin text-primary" />
      {label}
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t.loading} className={`${card} divide-y divide-line`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <span className="h-3 w-12 animate-shimmer rounded bg-surface-soft" />
          <span
            className="h-3 animate-shimmer rounded bg-line"
            style={{ width: `${60 - ((i * 13) % 30)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex animate-fade-in flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface/60 p-8 text-center text-ink-subtle">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-sky/60 text-primary">
        <Icon aria-hidden className="size-6" />
      </span>
      {children}
    </div>
  );
}

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => use(ToastContext);

/** Short "Saved" style messages at the bottom of the screen; hides after 3 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; leaving: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!toast || toast.leaving) return;
    const leave = setTimeout(() => setToast((x) => x && { ...x, leaving: true }), 2800);
    return () => clearTimeout(leave);
  }, [toast]);
  useEffect(() => {
    if (!toast?.leaving) return;
    const remove = setTimeout(() => setToast(null), 200);
    return () => clearTimeout(remove);
  }, [toast]);
  const show = useCallback(
    (message: string) => setToast({ id: Date.now(), message, leaving: false }),
    [],
  );
  return (
    <ToastContext value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 print:hidden"
      >
        {toast && (
          <div
            key={toast.id}
            className={`flex animate-toast-in items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-raised transition duration-200 ${toast.leaving ? 'translate-y-2 opacity-0' : ''}`}
          >
            <CircleCheck aria-hidden className="size-4 text-accent-sky" />
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext>
  );
}
