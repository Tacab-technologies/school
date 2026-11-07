import { describe, expect, it } from 'vitest';
import type { Class, Section, Subject } from '../academic-structure/types';
import type { TeacherAssignment } from './types';
import { assignmentsByCell, buildGrid, cellKey, cellsOfColumn, cellsOfRow, toggleGroup, toItem } from './quickAssign';

const cls = (id: string, name: string) => ({ _id: id, cl_no: id, cl_name: name, lev_no: 'l' }) as Class;
const section = (id: string, name: string, classId: string) => ({ _id: id, name, class: classId }) as Section;
const subject = (id: string, name: string, classIds: string[] = [], status = 'active') => ({ _id: id, sub_no: id, sub_name: name, classIds, status }) as Subject;

const classes = [cls('g10', 'Grade 10'), cls('g2', 'Grade 2')];
const sections = [section('b', 'B', 'g2'), section('a', 'A', 'g2')];
const subjects = [
  subject('sci', 'Science', ['g10']),
  subject('math', 'Maths'),
  subject('old', 'Old subject', [], 'inactive'),
  subject('none', 'Other', ['g99']),
];

describe('buildGrid', () => {
  it('has a row per section, a row for a class without sections, in school order', () => {
    const { rows, columns } = buildGrid(classes, sections, subjects);
    expect(rows.map((r) => r.label)).toEqual(['Grade 2 A', 'Grade 2 B', 'Grade 10']);
    expect(rows.map((r) => r.sectionId)).toEqual(['a', 'b', null]);
    expect(columns.map((c) => c.sub_name)).toEqual(['Maths', 'Science']);
  });

  it('only gives a row boxes for the subjects its class takes', () => {
    const { rows } = buildGrid(classes, sections, subjects);
    expect([...rows[0].subjectIds]).toEqual(['math']);
    expect([...rows[2].subjectIds].sort()).toEqual(['math', 'sci']);
  });
});

describe('ticking a whole row or column', () => {
  const { rows } = buildGrid(classes, sections, subjects);

  it('ticks the rest of a row, then unticks it all', () => {
    const cells = cellsOfRow(rows[2]);
    const some = new Set([cellKey('g10', null, 'math')]);
    const all = toggleGroup(some, cells);
    expect([...all].sort()).toEqual([...cells].sort());
    expect(toggleGroup(all, cells).size).toBe(0);
  });

  it('skips classes that do not take the subject', () => {
    expect(cellsOfColumn(rows, 'sci')).toEqual([cellKey('g10', null, 'sci')]);
    expect(cellsOfColumn(rows, 'math')).toHaveLength(3);
  });
});

describe('assignmentsByCell', () => {
  it('pre-ticks only the chosen term', () => {
    const assignment = (term: string, section: { _id: string } | null) => ({
      _id: term, termId: { _id: term }, classId: { _id: 'g2' }, sectionId: section, subjectId: { _id: 'math' }, timetableSlots: [],
    }) as unknown as TeacherAssignment;
    const byCell = assignmentsByCell([assignment('t1', { _id: 'a' }), assignment('t2', { _id: 'b' })], 't1');
    expect([...byCell.keys()]).toEqual([cellKey('g2', 'a', 'math')]);
  });
});

describe('toItem', () => {
  it('turns a box back into what the server takes', () => {
    expect(toItem(cellKey('g2', 'a', 'math'))).toEqual({ classId: 'g2', sectionId: 'a', subjectId: 'math' });
    expect(toItem(cellKey('g10', null, 'sci'))).toEqual({ classId: 'g10', sectionId: null, subjectId: 'sci' });
  });
});
