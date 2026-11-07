// Reading a pasted list (or a CSV file) of new logins for "Add many users".
// One person per line: First name, Last name, Email, Role — separated by
// commas, or by tabs when copied straight out of Excel — and for teachers,
// parents and students an optional fifth column (see FIFTH_COLUMN). The server
// checks every row again before anything is created, and is the one that finds
// the registered parent or student a login belongs to.

export const BULK_LIMIT = 200;
// Excel puts this invisible mark at the start of a saved CSV file.
export const BOM = String.fromCharCode(0xfeff);

// What the fifth column holds, for the roles that use one.
export const FIFTH_COLUMN: Record<string, string> = {
  teacher: 'Phone',
  parent: 'Phone',
  student: 'Admission number',
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BulkRole { key: string; name: string }

export interface BulkRow {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  roleText: string;
  /** The role key, when the text matched a role. */
  role: string | null;
  /** The optional fifth column. */
  extra: string;
  problems: string[];
}

/** Splits one line into cells; quotes ("Smith, Jr") keep commas inside a cell. */
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === separator) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const normalise = (text: string) => text.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/** Role text ("Accountant", "academic_officer", a custom role's name) to its key. */
export function matchRole(text: string, roles: BulkRole[]): string | null {
  const wanted = normalise(text);
  if (!wanted) return null;
  const found = roles.find((r) => normalise(r.key) === wanted || normalise(r.name) === wanted);
  return found ? found.key : null;
}

/** A first line like "First name, Last name, Email, Role" is a heading, not a person. */
const isHeading = (cells: string[]) =>
  cells.some((c) => /^e-?mail/i.test(c)) && !cells.some((c) => c.includes('@'));

export function parseBulkUsers(text: string, roles: BulkRole[], defaultRole = ''): BulkRow[] {
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/).filter((line) => line.trim() !== '');
  const table = lines.map((line) => splitLine(line, line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ','));
  if (table.length && isHeading(table[0])) table.shift();

  const firstRowFor = new Map<string, number>();
  return table.map((cells, index) => {
    const [firstName = '', lastName = '', email = '', roleCell = '', extra = ''] = cells;
    const roleText = roleCell || defaultRole;
    const row: BulkRow = {
      row: index + 1, firstName, lastName, email: email.toLowerCase(), roleText, role: matchRole(roleText, roles), extra, problems: [],
    };
    if (!firstName) row.problems.push('First name is missing.');
    if (!lastName) row.problems.push('Last name is missing.');
    if (!row.email) row.problems.push('Email is missing.');
    else if (!EMAIL_PATTERN.test(row.email)) row.problems.push('Email is not a valid address.');
    else if (firstRowFor.has(row.email)) row.problems.push(`This email is also on row ${firstRowFor.get(row.email)}.`);
    else firstRowFor.set(row.email, row.row);
    if (!roleText) row.problems.push('Role is missing.');
    else if (!row.role) row.problems.push(`"${roleText}" is not a role.`);
    else if (extra && !FIFTH_COLUMN[row.role]) row.problems.push('Only teacher, parent and student lines use a fifth column.');
    if (cells.length > 5 && cells.slice(5).some(Boolean)) row.problems.push('Has too many columns. Use: First name, Last name, Email, Role, then a phone or admission number.');
    return row;
  });
}

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The created logins as a CSV file the office can print or keep. */
export function credentialsCsv(rows: { name: string; email: string; role: string; temporaryPassword: string }[]): string {
  const lines = [['Name', 'Email', 'Role', 'Temporary password'], ...rows.map((r) => [r.name, r.email, r.role, r.temporaryPassword])];
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n');
}
