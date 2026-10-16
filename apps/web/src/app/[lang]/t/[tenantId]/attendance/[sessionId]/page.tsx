import { AttendanceRegister } from '@/components/attendance/register';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return <AttendanceRegister />;
}
