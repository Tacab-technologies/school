import { describe, expect, it } from 'vitest';
import { credentialsCsv, parseBulkUsers } from './bulkUsers';

const roles = [
  { key: 'accountant', name: 'Accountant' },
  { key: 'academic_officer', name: 'Academic Officer' },
  { key: 'front_desk', name: 'Front Desk' },
  { key: 'teacher', name: 'Teacher' },
  { key: 'parent', name: 'Parent' },
  { key: 'student', name: 'Student' },
];

describe('parseBulkUsers', () => {
  it('reads tab-separated rows copied from Excel, skipping the heading', () => {
    const rows = parseBulkUsers('First name\tLast name\tEmail\tRole\nAmina\tAli\tAmina@School.com\tAccountant\nBashir\tOmar\tb@school.com\tacademic officer', roles);
    expect(rows.map((r) => [r.row, r.firstName, r.email, r.role, r.problems])).toEqual([
      [1, 'Amina', 'amina@school.com', 'accountant', []],
      [2, 'Bashir', 'b@school.com', 'academic_officer', []],
    ]);
  });

  it('reads comma-separated rows with quotes, and uses the default role for blank ones', () => {
    const rows = parseBulkUsers('"Cawo, Jr", Nur, c@school.com,\n\nDeeqa, Yusuf, d@school.com, front_desk', roles, 'accountant');
    expect(rows.map((r) => [r.firstName, r.role])).toEqual([['Cawo, Jr', 'accountant'], ['Deeqa', 'front_desk']]);
  });

  it('flags each problem on its own row', () => {
    const rows = parseBulkUsers([
      ', Ali, a@school.com, Accountant',
      'Bad, Email, not-an-email, Accountant',
      'One, Twice, same@school.com, Accountant',
      'Two, Twice, SAME@school.com, Accountant',
      'No, Role, n@school.com, Janitor',
      'Staff, Fifth, s@school.com, Accountant, 0612345678',
      'Too, Many, m@school.com, Parent, 0612345678, extra',
    ].join('\n'), roles);
    expect(rows[0].problems).toEqual(['First name is missing.']);
    expect(rows[1].problems[0]).toMatch(/valid address/);
    expect(rows[2].problems).toEqual([]);
    expect(rows[3].problems[0]).toMatch(/also on row 3/);
    expect(rows[4].problems[0]).toMatch(/not a role/);
    expect(rows[5].problems[0]).toMatch(/Only teacher, parent and student lines/);
    expect(rows[6].problems[0]).toMatch(/too many columns/);
  });

  it('accepts teachers, parents and students, with or without the fifth column', () => {
    const rows = parseBulkUsers([
      'A, Teacher, t@school.com, Teacher',
      'B, Teacher, t2@school.com, Teacher, 0612345678',
      'A, Parent, p@school.com, Parent, 0619876543',
      'A, Student, s@school.com, Student, HAA-2026-0001',
    ].join('\n'), roles);
    expect(rows.map((r) => [r.role, r.extra, r.problems])).toEqual([
      ['teacher', '', []],
      ['teacher', '0612345678', []],
      ['parent', '0619876543', []],
      ['student', 'HAA-2026-0001', []],
    ]);
  });
});

describe('credentialsCsv', () => {
  it('quotes cells that need it', () => {
    expect(credentialsCsv([{ name: 'Ali, Jr', email: 'a@s.com', role: 'Accountant', temporaryPassword: 'ab"c' }]))
      .toBe('Name,Email,Role,Temporary password\r\n"Ali, Jr",a@s.com,Accountant,"ab""c"');
  });
});
