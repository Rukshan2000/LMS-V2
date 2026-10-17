import { DocsPage } from '@/components/admin/docs';

// Content loads from the API after the admin shell checks the session (platform admins only).
export const instant = false;

export default function Page() {
  return <DocsPage />;
}
