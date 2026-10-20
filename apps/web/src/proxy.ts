import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, locales, pickLocale } from './i18n/config';

// Every page lives under /si, /ta or /en. Redirect anything without a locale prefix.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Files like favicon.ico. Only a short extension counts: invite links (/join/<tenant>.<token>)
  // have a dot too.
  if (/\.\w{1,16}$/.test(pathname)) return;
  if (locales.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;

  const locale = pickLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
  );
  request.nextUrl.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Skip the API (served by nginx in production) and Next internals.
  matcher: ['/((?!api|_next).*)'],
};
