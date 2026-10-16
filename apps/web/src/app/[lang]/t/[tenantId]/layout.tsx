import { Suspense } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { Loading } from '@/components/loading';

// The tenant id is only known at request time, so the shell streams in behind Suspense.
export default function TenantLayout({ children }: LayoutProps<'/[lang]/t/[tenantId]'>) {
  return (
    <Suspense fallback={<Loading />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
