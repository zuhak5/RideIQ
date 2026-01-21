export function formatIQD(amount: number | bigint): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';

  // Iraq's de-facto UX is whole dinars (no decimals).
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'IQD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.trunc(n).toLocaleString()} IQD`;
  }
}

export function formatSignedIQD(amount: number | bigint): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(n));
  // Keep the sign outside the currency formatting to avoid locale edge-cases.
  return `${sign}${formatIQD(abs)}`;
}
