import { Timetable } from '@/components/timetable';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return <Timetable />;
}
