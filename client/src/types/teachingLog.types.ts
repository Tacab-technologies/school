export type TeachingLogStatus = 'draft' | 'completed';

export interface CreatorInfo {
  name: string;
  email: string;
}

export interface TeachingLog {
  _id: string;
  assignmentId?: string;
  periodId?: string;
  date: string;
  subject: string;
  classId: string;
  section: string;
  period: string; // e.g. "Period 1 (08:00 - 09:00)"
  topicTaught: string; // shown to teachers as the lesson title
  lessonObjective?: string;
  // No longer collected by the form; older logs may still carry values, so
  // views render these only when present.
  teachingSummary?: string;
  learningOutcomes?: string;
  studentParticipation?: string;
  challengesFaced?: string;
  extraNotes?: string;
  homeworkGiven?: string;
  submissionDeadline?: string;
  status: TeachingLogStatus;
  createdBy: CreatorInfo;
  createdAt: string;
  updatedAt: string;
}

/** What the client sends on create/update; the rest is filled in by the server. */
export type TeachingLogInput = Omit<TeachingLog, '_id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export interface TeachingLogFilters {
  teacherId?: string;
  search?: string;
  classId?: string;
  subject?: string;
  status?: TeachingLogStatus | '';
  date?: string;
}

export interface PaginatedLogs {
  logs: TeachingLog[];
  total: number;
  page: number;
  limit: number;
}
