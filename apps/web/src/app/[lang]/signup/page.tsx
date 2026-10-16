import { AuthForm } from '@/components/auth-form';
import { LanguageSwitcher } from '@/components/language-switcher';

export default function Page() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <AuthForm mode="signup" />
      <LanguageSwitcher />
    </main>
  );
}
