import { Locked } from '@/components/locked';
import { StudentImport } from '@/components/students/student-import';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <Locked feature="student_import">
      <StudentImport />
    </Locked>
  );
}
