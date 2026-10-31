/** Colour bucket for the compact quota bar, keyed on remaining percent. */

/** Remaining percent above this is healthy (green). */
export const SUMMARY_HIGH_REMAINING_PERCENT = 50;
/** Remaining percent at or above this (and not healthy) is a warning (amber); below is red. */
export const SUMMARY_MEDIUM_REMAINING_PERCENT = 20;

/** Tone bucket for a remaining percent: >50 high, 20–50 medium, <20 low. */
export function summaryRemainingTone(remaining: number): 'high' | 'medium' | 'low' {
  if (remaining > SUMMARY_HIGH_REMAINING_PERCENT) return 'high';
  if (remaining >= SUMMARY_MEDIUM_REMAINING_PERCENT) return 'medium';
  return 'low';
}
