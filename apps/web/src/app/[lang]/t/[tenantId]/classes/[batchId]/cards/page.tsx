import { CardSheet } from '@/components/attendance/card-sheet';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return <CardSheet />;
}
