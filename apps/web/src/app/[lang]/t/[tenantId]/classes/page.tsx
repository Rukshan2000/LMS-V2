import { ClassList } from '@/components/classes/class-list';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return <ClassList />;
}
