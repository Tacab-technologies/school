import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuickAssignDrawer from './QuickAssignDrawer';
import { teachersApi } from '../api/teachersApi';
import { confirmAction } from '@/components/common/ConfirmDialog';
import type { Class, Section, Subject, Term } from '../../academic-structure/types';
import type { TeacherAssignment } from '../types';

vi.mock('../api/teachersApi', () => ({ teachersApi: { saveAssignments: vi.fn() } }));
vi.mock('@/components/common/ConfirmDialog', () => ({ confirmAction: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const classes = [{ _id: 'g5', cl_no: 'G5', cl_name: 'Grade 5', lev_no: 'l' }, { _id: 'g6', cl_no: 'G6', cl_name: 'Grade 6', lev_no: 'l' }] as Class[];
const sections = [{ _id: 'a', name: 'A', class: 'g5' }, { _id: 'b', name: 'B', class: 'g5' }] as Section[];
const subjects = [
  { _id: 'math', sub_no: 'M', sub_name: 'Maths', classIds: [], status: 'active' },
  { _id: 'sci', sub_no: 'S', sub_name: 'Science', classIds: ['g5'], status: 'active' },
] as Subject[];
const terms = [
  { _id: 't0', name: 'Term 0', academicYearId: 'y', status: 'inactive', workingDays: [] },
  { _id: 't1', name: 'Term 1', academicYearId: 'y', status: 'active', workingDays: [] },
] as Term[];
const assignment = (id: string, section: string | null, subject: string, lessons = 0) => ({
  _id: id, teacherId: 'teacher', termId: { _id: 't1', name: 'Term 1' }, classId: { _id: section ? 'g5' : 'g6', cl_name: section ? 'Grade 5' : 'Grade 6', cl_no: 'x' },
  sectionId: section ? { _id: section, name: section.toUpperCase() } : null, subjectId: { _id: subject, sub_name: subject, sub_no: 'x' },
  timetableSlots: Array.from({ length: lessons }, () => ({ day: 'Monday', periodId: { _id: 'p' } })),
}) as unknown as TeacherAssignment;

const open = (assignments: TeacherAssignment[] = []) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<QuickAssignDrawer teacherId="teacher" teacherName="Amina" assignments={assignments} classes={classes} sections={sections} subjects={subjects} terms={terms} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
};
const box = (name: string) => screen.getByRole('checkbox', { name });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('QuickAssignDrawer', () => {
  beforeEach(() => {
    vi.mocked(teachersApi.saveAssignments).mockReset().mockResolvedValue({ added: 0, removed: 0, kept: 0, lessonsRemoved: 0 });
    vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
  });

  it('opens on the active term with what the teacher teaches already ticked', () => {
    open([assignment('1', 'a', 'math')]);
    expect(screen.getByLabelText('Term')).toHaveTextContent('Term 1');
    expect(box('Maths in Grade 5 A')).toBeChecked();
    expect(box('Maths in Grade 5 B')).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Science in Grade 6' })).toBeNull(); // Grade 6 doesn't take it
  });

  it('saves everything ticked in one go, using the whole-column box', async () => {
    const { onSaved, onClose } = open();
    fireEvent.click(box('Tick Maths in every class'));
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(teachersApi.saveAssignments).toHaveBeenCalledWith('teacher', {
      termId: 't1',
      items: [
        { classId: 'g5', sectionId: 'a', subjectId: 'math' },
        { classId: 'g5', sectionId: 'b', subjectId: 'math' },
        { classId: 'g6', sectionId: null, subjectId: 'math' },
      ],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('warns before unticking a class with lessons, and stops if told no', async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    open([assignment('1', 'a', 'math', 2)]);
    fireEvent.click(box('Maths in Grade 5 A'));
    save();
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(vi.mocked(confirmAction).mock.calls[0][0].text).toMatch(/lessons on the timetable/);
    expect(teachersApi.saveAssignments).not.toHaveBeenCalled();
  });

  it('keeps an assignment that has no box any more', async () => {
    const { onSaved } = open([assignment('1', 'gone', 'math')]);
    expect(screen.getByText(/left as they are/)).toBeInTheDocument();
    fireEvent.click(box('Science in Grade 5 A'));
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(vi.mocked(teachersApi.saveAssignments).mock.calls[0][1].items).toEqual([
      { classId: 'g5', sectionId: 'gone', subjectId: 'math' },
      { classId: 'g5', sectionId: 'a', subjectId: 'sci' },
    ]);
  });

  it('shows the server\'s message when a save is refused', async () => {
    vi.mocked(teachersApi.saveAssignments).mockRejectedValue({ response: { data: { message: 'Science is not taught in Grade 5.' } } });
    open();
    fireEvent.click(box('Science in Grade 5 A'));
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Science is not taught in Grade 5.');
  });
});
