import { FamilyOr } from '@/components/portal';
import { FeesMonth } from '@/components/fees/fees-month';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <FamilyOr section="fees">
      <FeesMonth />
    </FamilyOr>
  );
}
