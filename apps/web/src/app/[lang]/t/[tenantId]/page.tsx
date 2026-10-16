import { Overview } from '@/components/overview';

// Tenant pages load their data in the browser after the shell resolves the session,
// so there is nothing to validate for instant navigation here.
export const instant = false;

export default function Page() {
  return <Overview />;
}
