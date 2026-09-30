/**
 * @module vcs/cronMatch
 * Minimal 5-field cron matcher used by the squash retention scheduler.
 */

function partMatches(
  part: string,
  value: number,
  min: number,
  max: number,
): boolean {
  // Handle step: */N or range/N
  const [rangePart, stepStr] = part.split('/');
  const step = stepStr ? parseInt(stepStr, 10) : 1;

  if (rangePart === '*') {
    return (value - min) % step === 0;
  }

  // Handle range: N-M
  if (rangePart.includes('-')) {
    const [startStr, endStr] = rangePart.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  }

  // Plain number. For day-of-week, 7 also means Sunday (0).
  const num = parseInt(rangePart, 10);
  if (step === 1 && max === 7 && num === 7) return value === 0;
  return value === num;
}

function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  return field
    .split(',')
    .some((part) => partMatches(part.trim(), value, min, max));
}

/**
 * Check whether a standard 5-field cron expression matches a time.
 * Fields: minute hour day-of-month month day-of-week.
 * Supports numbers, wildcards, lists (1,3,5), ranges (1-5) and steps.
 *
 * @param cronExpr - The cron expression.
 * @param now - The time to test (default: now).
 * @returns true if every field matches.
 */
export function cronMatchesNow(
  cronExpr: string,
  now: Date = new Date(),
): boolean {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  return (
    fieldMatches(fields[0], now.getMinutes(), 0, 59) &&
    fieldMatches(fields[1], now.getHours(), 0, 23) &&
    fieldMatches(fields[2], now.getDate(), 1, 31) &&
    fieldMatches(fields[3], now.getMonth() + 1, 1, 12) &&
    fieldMatches(fields[4], now.getDay(), 0, 7)
  );
}
