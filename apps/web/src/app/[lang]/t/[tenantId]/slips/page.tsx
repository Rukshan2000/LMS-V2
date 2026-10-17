import { SlipsPage } from '@/components/fees/slips-page';
import { Locked } from '@/components/locked';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <Locked feature="bank_slips">
      <SlipsPage />
    </Locked>
  );
}
