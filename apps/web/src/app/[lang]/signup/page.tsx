import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SignupPage } from '@/components/password-reset';

export default function Page() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-linear-to-b from-canvas to-accent-sky/50 px-4 py-10">
      {/* ?email= (from the "account ready" email) is read in the browser. */}
      <Suspense fallback={<AuthForm mode="signup" />}>
        <SignupPage />
      </Suspense>
      <LanguageSwitcher />
    </main>
  );
}
