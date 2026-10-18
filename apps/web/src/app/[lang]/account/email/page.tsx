import { EmailSettings } from '@/components/email-settings';

export default function Page() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-linear-to-b from-canvas to-accent-sky/50 px-4 py-10">
      <EmailSettings />
    </main>
  );
}
