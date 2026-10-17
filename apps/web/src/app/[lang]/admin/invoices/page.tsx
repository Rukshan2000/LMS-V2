import { InvoicesPage } from '@/components/admin/invoices';

// Data loads in the browser after the admin shell checks the session.
export const instant = false;

export default function Page() {
  return <InvoicesPage />;
}
