import { FamilyOr } from '@/components/portal';
import { AttendanceDay } from '@/components/attendance/attendance-day';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <FamilyOr section="attendance">
      <AttendanceDay />
    </FamilyOr>
  );
}
