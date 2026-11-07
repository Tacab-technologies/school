import { describe, expect, it } from 'vitest';
import { formatCell, formatSummaryValue, humanizeLabel, messageOf, totalsFor } from './format';

describe('report formatting', () => {
  it('turns raw keys into readable headings and leaves real labels alone', () => {
    expect(humanizeLabel('className')).toBe('Class name');
    expect(humanizeLabel('fee_type')).toBe('Fee type');
    expect(humanizeLabel('Admission No')).toBe('Admission No');
    expect(humanizeLabel('Students')).toBe('Students');
  });

  it('formats money, numbers, percentages, dates and blanks', () => {
    expect(formatCell(1234.5, { type: 'money', label: 'Paid', key: 'paid' })).toBe(`$${(1234.5).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    expect(formatCell(90, { type: 'number', label: 'Score %', key: 'percent' })).toBe('90%');
    expect(formatCell(1200, { type: 'number', label: 'Students', key: 'students' })).toBe((1200).toLocaleString());
    expect(formatCell('2026-03-04T00:00:00.000Z', { label: 'Date', key: 'date' })).not.toContain('T00');
    expect(formatCell(null)).toBe('—');
    expect(formatCell('')).toBe('—');
  });

  it('totals counts and money but never averages or percentages', () => {
    const columns = [
      { key: 'className', label: 'Class' },
      { key: 'students', label: 'Students', type: 'number' as const },
      { key: 'rate', label: 'Attendance %', type: 'number' as const },
      { key: 'paid', label: 'Paid', type: 'money' as const },
    ];
    const rows = [
      { className: 'A', students: 10, rate: 90, paid: 100 },
      { className: 'B', students: 5, rate: 80, paid: 50.5 },
    ];
    expect(totalsFor(columns, rows)).toEqual({ students: 15, paid: 150.5 });
    expect(totalsFor(columns, rows.slice(0, 1))).toBeNull();
  });

  it('shows money in summaries only where the line is an amount', () => {
    expect(formatSummaryValue('Total Collected', 50)).toContain('$');
    expect(formatSummaryValue('Fully Paid', 12)).toBe('12');
  });

  it('recognises a message-only result', () => {
    expect(messageOf([{ key: 'message', label: 'No classes are assigned to you yet.' }])).toBe('No classes are assigned to you yet.');
    expect(messageOf([{ key: 'name', label: 'Student' }])).toBe('');
  });
});
