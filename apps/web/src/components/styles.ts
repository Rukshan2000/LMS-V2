// Class helpers shared by client and server components (no 'use client', so server pages can call them).

/** White surface used by every section and list. */
export const card = 'rounded-xl border border-line bg-surface shadow-card';

const variants = {
  primary: 'bg-primary text-white shadow-sm hover:bg-primary-hover',
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-primary-ring hover:bg-surface-soft',
  danger: 'bg-danger-solid text-white hover:bg-danger-hover',
  dangerOutline: 'border border-danger/30 bg-surface text-danger hover:bg-danger-soft',
  whatsapp: 'bg-success-solid text-white shadow-sm hover:bg-success-hover',
  success: 'bg-success-solid text-white shadow-sm hover:bg-success-hover',
  /** Inline text actions inside lists (Move, Add, Copy link…). */
  link: 'text-primary hover:text-primary-hover',
  linkDanger: 'text-danger hover:text-danger-solid',
  linkMuted: 'text-ink-muted hover:text-ink',
};
const sizes = { none: '', xs: 'px-2 py-1 text-xs', sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5' };
export type Variant = keyof typeof variants;
export type Size = keyof typeof sizes;

/** Button look for <button>, <Link> and <a>. */
export const btn = (variant: Variant = 'primary', size: Size = 'sm', full = false) =>
  `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60 ${variants[variant]} ${sizes[size]}${full ? ' w-full' : ''}`;
