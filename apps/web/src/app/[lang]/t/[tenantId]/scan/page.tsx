import { ScanPage } from '@/components/attendance/scan-page';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return <ScanPage />;
}
