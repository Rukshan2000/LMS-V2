// Amounts arrive from the API as numeric strings ("2500.00"). Format them without
// converting to floating point.

/** "2500.00" → "2,500.00" */
export function fmtMoney(amount: string | null | undefined): string {
  const [int = '0', dec = '00'] = String(amount ?? '0').split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec.padEnd(2, '0').slice(0, 2)}`;
}

/** "2500.5" → 250050; for comparisons and sums only. */
export const cents = (amount: string) => {
  const [int = '0', dec = ''] = amount.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0').slice(0, 2));
};

/** 250050 → "2500.50" */
export const fromCents = (c: number) =>
  `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
