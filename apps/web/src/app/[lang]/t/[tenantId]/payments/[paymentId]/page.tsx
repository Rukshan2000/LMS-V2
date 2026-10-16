import { ReceiptPage } from '@/components/fees/receipt-page';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return <ReceiptPage />;
}
