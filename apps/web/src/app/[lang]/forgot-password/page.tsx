import { LanguageSwitcher } from '@/components/language-switcher';
import { PasswordReset } from '@/components/password-reset';

export default function Page() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-linear-to-b from-canvas to-accent-sky/50 px-4 py-10">
      <PasswordReset />
      <LanguageSwitcher />
    </main>
  );
}
