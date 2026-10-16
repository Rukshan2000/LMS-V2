import { Suspense } from 'react';
import { JoinInvite } from '@/components/join-invite';
import { Loading } from '@/components/loading';

// The invite code is only known at request time; everything loads in the browser.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <JoinInvite />
    </Suspense>
  );
}
