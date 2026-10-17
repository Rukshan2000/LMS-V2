import { SettingsPage } from '@/components/admin/settings';

// Data loads in the browser after the admin shell checks the session.
export const instant = false;

export default function Page() {
  return <SettingsPage />;
}
