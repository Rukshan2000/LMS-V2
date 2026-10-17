import { BillingLink } from '@/components/settings/billing-link';
import { StaffSettings } from '@/components/settings/staff-settings';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <div className="space-y-6">
      <StaffSettings />
      <BillingLink />
    </div>
  );
}
