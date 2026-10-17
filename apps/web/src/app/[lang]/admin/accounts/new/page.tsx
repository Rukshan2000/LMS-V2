import { NewAccount } from '@/components/admin/accounts';

// Data loads in the browser after the admin shell checks the session.
export const instant = false;

export default function Page() {
  return <NewAccount />;
}
