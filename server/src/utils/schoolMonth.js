import { SCHOOL_TIMEZONE } from './schoolTime.js';

const round2 = (n) => Math.round(n * 100) / 100;

// How far the school's clock is ahead of UTC at this moment, in milliseconds.
const zoneOffset = (at) => {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)) p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime();
};

const monthStart = (year, month) => {
  const utc = new Date(Date.UTC(year, month - 1, 1));
  return new Date(utc.getTime() - zoneOffset(utc));
};

/** A Mongo date filter for one month ('YYYY-MM') on the school's clock. */
export const schoolMonthRange = (period) => {
  const [y, m] = period.split('-').map(Number);
  return { $gte: monthStart(y, m), $lt: monthStart(y, m + 1) };
};

/**
 * A day the accountant picked ('YYYY-MM-DD'), stored at noon UTC: it stays on
 * that calendar day, and in that month, in every timezone a school could be in.
 */
export const dayToDate = (day) => new Date(`${day}T12:00:00.000Z`);

export { round2 };
