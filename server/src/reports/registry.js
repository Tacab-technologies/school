/**
 * The report catalogue.
 *
 * A school's departments need different information, so reports are grouped by
 * department and gated by role rather than pooled into one page. Each report is
 * one entry here — id, who may run it, what filters it accepts, and a `run`
 * that returns a uniform table. Adding a report means adding a definition, not
 * a new route, controller and client screen.
 *
 * Every `run` resolves to:
 *   { columns: [{ key, label, type? }], rows: [...], summary?: [{ label, value }] }
 * so one client component renders any report and one CSV export serialises it.
 */

import { academicReports } from './academicReports.js';
import { teacherReports } from './teacherReports.js';
import { examReports, officeExamReports } from './examReports.js';
import { financeReports } from './financeReports.js';
import { resultsReports } from './resultsReports.js';
import { attendanceReports } from './attendanceReports.js';
import { peopleReports } from './peopleReports.js';
import { timetableReports } from './timetableReports.js';
import { filterOptionsReport } from './filterOptions.js';
import { questionFor } from './plainLanguage.js';

/** Departments, in the order the UI lists them. */
export const DEPARTMENTS = [
  {
    id: 'academic',
    name: 'Academic Office',
    description: 'Students and parents, exam results, attendance, teachers and timetables',
    roles: ['admin', 'principal', 'academic_officer']
  },
  {
    // Teachers only. The academic office already sees every class (and every
    // teacher) under Academic Office, so it is not offered a second, duplicate
    // "teaching" view — the school found that confusing.
    id: 'teaching',
    name: 'My Classes',
    description: 'Students, timetable, attendance, marks and results for the classes you teach',
    roles: ['teacher']
  },
  {
    id: 'finance',
    name: 'Finance Office',
    description: 'Fee collection, payments, outstanding balances and revenue',
    roles: ['admin', 'accountant', 'principal']
  }
];

// Order matters: each department lists its groups in the order they first
// appear here.
const ALL_REPORTS = [
  ...academicReports,
  ...teacherReports,
  ...examReports,
  ...peopleReports,
  ...resultsReports,
  ...officeExamReports,
  ...attendanceReports,
  ...timetableReports,
  ...financeReports,
  // Not a report: the filter choices for the Reports page (hidden from the catalogue).
  filterOptionsReport
];

const byId = new Map(ALL_REPORTS.map((report) => [report.id, report]));

export const getReport = (id) => byId.get(id) ?? null;

// `role` may be one role or a list (a custom role borrows the report access of
// built-in roles — see reportController's reportRolesFor).
const anyOf = (allowed, role) => [].concat(role).some((r) => allowed.includes(r));

export const canRun = (report, role) => Boolean(report) && anyOf(report.roles, role);

/**
 * The catalogue this role may actually run, grouped for display. Reports the
 * caller can't run are omitted entirely rather than shown and refused.
 */
export const getCatalogFor = (role) => {
  const departments = DEPARTMENTS.filter((d) => anyOf(d.roles, role)).map((department) => {
    const reports = ALL_REPORTS.filter((r) => !r.hidden && r.department === department.id && anyOf(r.roles, role));

    // Preserve each group's first-appearance order rather than sorting
    // alphabetically — the groups read as a workflow.
    const groups = [];
    const groupIndex = new Map();
    for (const report of reports) {
      if (!groupIndex.has(report.group)) {
        groupIndex.set(report.group, groups.length);
        groups.push({ name: report.group, reports: [] });
      }
      groups[groupIndex.get(report.group)].reports.push({
        id: report.id,
        title: report.title,
        // One plain-language line: the question this report answers.
        question: questionFor(report),
        description: report.description,
        filters: report.filters ?? []
      });
    }

    return { ...department, groups, report_count: reports.length };
  });

  return departments.filter((d) => d.report_count > 0);
};
