import { PriceBooks } from '@/components/admin/price-books';

// Data loads in the browser after the admin shell checks the session.
export const instant = false;

export default function Page() {
  return <PriceBooks />;
}
