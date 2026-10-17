import { Suspense } from 'react';
import { AdminShell } from '@/components/admin/admin-shell';
import { Loading } from '@/components/loading';

export default function AdminLayout({ children }: LayoutProps<'/[lang]/admin'>) {
  return (
    <Suspense fallback={<Loading />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
