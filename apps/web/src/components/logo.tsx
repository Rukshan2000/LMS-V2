import { useId } from 'react';

/** The app mark: an open book with a bookmark. Same drawing as app/icon.svg (the favicon),
 *  but coloured from the theme tokens so it follows the institute's colour. */
export function Logo({ className = 'size-8' }: { className?: string }) {
  const bg = useId();
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-primary)" />
          <stop offset="1" stopColor="var(--color-primary-hover)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${bg})`} />
      <path
        d="M32 21C26 16.5 18 15.5 11 16.5V46C18 45 26 46 32 50.5Z"
        fill="var(--color-primary-soft)"
      />
      <path d="M32 21C38 16.5 46 15.5 53 16.5V46C46 45 38 46 32 50.5Z" fill="#fff" />
      <path d="M41.5 17.4V32L45 29.2 48.5 32V16.7Z" fill="#fbbf24" />
    </svg>
  );
}
