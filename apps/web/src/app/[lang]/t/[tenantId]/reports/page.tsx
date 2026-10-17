import { Locked } from '@/components/locked';
import { Reports } from '@/components/reports';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <Locked feature="reports">
      <Reports />
    </Locked>
  );
}
