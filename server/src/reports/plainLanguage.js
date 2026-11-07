/**
 * The question each report answers, in the words office staff use.
 *
 * The Reports page leads with this line ("Which students owe fees?") so a
 * non-technical user can pick the right report without reading column lists.
 * The report's `description` stays as the longer explanation underneath.
 * A report without an entry falls back to its description.
 */

const QUESTIONS = {
  // Academic Office — Students
  'students-total': 'How many students do we have, and what is their status?',
  'students-by-class': 'How many boys and girls are in each class?',
  'students-by-section': 'How many students are in each section?',
  'students-new-admissions': 'Which students joined the school in these dates?',
  'students-withdrawn': 'Which students have left, or are inactive or suspended?',
  'students-active': 'Which students are currently studying here?',
  'students-demographics': 'What is the gender and age mix of our students?',
  'students-enrollment-trend': 'How many new students join each month?',
  'students-contact-list': 'How do I reach the parents of each student?',
  'students-no-parent': 'Which students are missing a parent or a parent phone number?',

  // Academic Office — Teaching assignments
  'assignments-teachers-by-subject': 'Who teaches each subject, and in which classes?',
  'assignments-teachers-by-class': 'Which teachers work with each class?',
  'assignments-workload': 'How many lessons does each teacher have per week?',
  'assignments-subject-assignments': 'Which classes and teachers does each subject have?',
  'assignments-conflicts': 'Are any classes or teachers booked twice at the same time?',
  'assignments-unassigned-subjects': 'Which subjects still have no teacher?',

  // Academic Office — Exams & results
  'exam-student-results': 'What did each student score, and what is their position in class?',
  'exam-results-by-class': 'How did each class do in each subject?',
  'results-school-summary': 'How is each class doing overall, and who is top?',
  'results-report-card': "What are one student's marks in every subject?",
  'results-subject-performance': 'Which subjects are strongest and weakest?',
  'results-exam-comparison': 'Did the class improve from one exam to the next?',
  'results-top-students': 'Who are the best students?',
  'results-need-help': 'Which students are failing and need extra help?',
  'results-marking-progress': 'Which teachers have finished entering marks, and who is behind?',

  // Academic Office — Attendance
  'attendance-daily-by-class': 'How many students came to school today, class by class?',
  'attendance-monthly-by-class': "What is each class's attendance rate this month?",
  'attendance-absent-late': 'Which students were absent or late?',
  'attendance-low': 'Which students miss school too often?',
  'attendance-staff-daily': 'Which teachers came to work today?',
  'attendance-staff-monthly': "How was each teacher's attendance this month?",

  // Academic Office — Timetable
  'timetable-by-class': "What is a class's weekly timetable?",
  'timetable-by-teacher': "What is a teacher's weekly timetable?",

  // My Classes (teachers)
  'teaching-my-classes': 'Which classes do I teach, and how many students are in each?',
  'teaching-my-subjects': 'Which subjects do I teach, and in which classes?',
  'teaching-my-timetable': 'When and where are my lessons this week?',
  'teaching-students-per-class': 'Who are the students in my classes?',
  'teaching-student-contacts': 'How do I reach the parents of my students?',
  'teaching-timetable-by-class': "What is the weekly timetable of a class I teach?",
  'teaching-attendance': 'What attendance has been recorded for my classes?',
  'teaching-attendance-percentage': "What is each of my students' attendance rate?",
  'teaching-low-attendance': 'Which of my students miss school too often?',
  'teaching-attendance-daily-by-class': 'How many of my students came to school today?',
  'teaching-attendance-monthly-by-class': "What is my classes' attendance rate this month?",
  'teaching-attendance-absent-late': 'Which of my students were absent or late?',
  'exam-my-class-results': 'What did each student score in my subject in this exam?',
  'exam-marking-progress': 'How many marks do I still have to enter?',
  'teaching-class-results': 'What did each student in my class score, and what is their position?',
  'teaching-results-by-class': 'How did my classes do in each subject?',
  'teaching-results-summary': 'How is each of my classes doing overall?',
  'teaching-report-card': "What are one of my students' marks in every subject?",
  'teaching-subject-performance': 'Which subjects are strongest and weakest in my classes?',
  'teaching-exam-comparison': 'Did my class improve from one exam to the next?',
  'teaching-top-students': 'Who are the best students in my classes?',
  'teaching-need-help': 'Which of my students are failing and need extra help?',

  // Finance Office
  'finance-collection-summary': 'How much fee money was expected, and how much came in?',
  'finance-fully-paid': 'Which students have paid all their fees?',
  'finance-partially-paid': 'Which students have paid only part of their fees?',
  'finance-unpaid': 'Which students have paid nothing yet?',
  'finance-collection-by-class': 'How much has each class paid, and how much does it still owe?',
  'finance-collection-by-year': 'How much was billed and collected in each school year?',
  'finance-collection-by-period': 'How much money came in each month?',
  'finance-payments-daily': 'How much money did we receive each day?',
  'finance-payments-weekly': 'How much money did we receive each week?',
  'finance-payments-monthly': 'How much money did we receive each month?',
  'finance-payment-history': 'What payments have been made, newest first?',
  'finance-receipts': 'Which receipts were issued, and for how much?',
  'finance-refunds': 'What money was given back, and why?',
  'finance-discounts': 'Which invoices got a discount, and how much did it cost?',
  'finance-waivers': 'Which students have a scholarship or waiver?',
  'finance-standing-discounts': 'Which students get a fixed discount every month?',
  'finance-student-fee-status': 'Has each student paid this month, and how much is left?',
  'finance-outstanding-students': 'Which students owe fees, and whom should I call?',
  'finance-outstanding-by-class': 'Which classes owe the most money?',
  'finance-aging': 'How long has unpaid money been overdue?',
  'finance-dashboard': 'What is the overall money picture for the school?'
};

/** The plain-language question for a report, or its description when none is written. */
export const questionFor = (report) => QUESTIONS[report?.id] ?? report?.description ?? '';

export { QUESTIONS };
