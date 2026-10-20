import { BillingLink } from '@/components/settings/billing-link';
import { PageSettings } from '@/components/settings/page-settings';
import { StaffSettings } from '@/components/settings/staff-settings';
import { ThemeSettings } from '@/components/settings/theme-settings';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <div className="space-y-6">
      <StaffSettings />
      <ThemeSettings />
      <PageSettings />
      <BillingLink />
    </div>
  );
}
