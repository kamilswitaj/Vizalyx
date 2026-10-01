/**
 * Cost formatting helpers adhering to Vizalyx display rules:
 * - PLN displayed primarily with standard 2 decimal places (or 4 for fractions < 0.01 zł).
 * - USD displayed with 4-5 decimal places to differentiate cheap image edits.
 */

export const ESTIMATED_PLN_TOOLTIP =
  'Converted using the NBP average USD/PLN exchange rate recorded at generation time. Your actual card charge may differ.';

export function formatPln(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) return '— zł';
  const decimals = amount > 0 && amount < 0.01 ? 4 : 2;
  const formatted = new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return `${formatted} zł`;
}

export function formatUsd(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) return '$—';
  const decimals = amount > 0 && amount < 0.001 ? 5 : 4;
  return `$${amount.toFixed(decimals)}`;
}

export function formatRunCost(cost?: { usd?: number; pln?: number } | null): string {
  if (!cost || typeof cost.usd !== 'number' || isNaN(cost.usd)) {
    return 'Cost unavailable';
  }
  if (cost.pln != null && !isNaN(cost.pln)) {
    return `${formatPln(cost.pln)} (${formatUsd(cost.usd)})`;
  }
  return formatUsd(cost.usd);
}
