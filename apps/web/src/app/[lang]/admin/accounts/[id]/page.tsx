import { AccountDetail } from '@/components/admin/account-detail';

// Data loads in the browser after the admin shell checks the session.
export const instant = false;

export default function Page() {
  return <AccountDetail />;
}
