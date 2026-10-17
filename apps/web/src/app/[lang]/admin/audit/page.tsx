import { AuditPage } from '@/components/admin/audit';

// Data loads in the browser after the admin shell checks the session.
export const instant = false;

export default function Page() {
  return <AuditPage />;
}
