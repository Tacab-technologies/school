import {
  CalendarBlank, CalendarCheck, Chalkboard, ChartPie, Coins, Exam, Receipt, Student, Wallet, Buildings, ChartBar,
  type Icon,
} from '@phosphor-icons/react';

// An icon and a pastel tile for every report group and department, so a
// person scanning the Reports page can find "money", "attendance" or
// "results" by picture as well as by word. Unknown names get a neutral chart.

export type Tile = 'bg-tile-blue' | 'bg-tile-green' | 'bg-tile-yellow' | 'bg-tile-pink' | 'bg-tile-violet';

export interface GroupLook {
  icon: Icon;
  tile: Tile;
}

const GROUPS: Record<string, GroupLook> = {
  students: { icon: Student, tile: 'bg-tile-blue' },
  'classes & students': { icon: Student, tile: 'bg-tile-blue' },
  'teaching assignments': { icon: Chalkboard, tile: 'bg-tile-violet' },
  'exams & results': { icon: Exam, tile: 'bg-tile-yellow' },
  'marks & results': { icon: Exam, tile: 'bg-tile-yellow' },
  attendance: { icon: CalendarCheck, tile: 'bg-tile-green' },
  timetable: { icon: CalendarBlank, tile: 'bg-tile-pink' },
  'fee collection': { icon: Coins, tile: 'bg-tile-green' },
  payments: { icon: Receipt, tile: 'bg-tile-blue' },
  'outstanding balances': { icon: Wallet, tile: 'bg-tile-pink' },
  'financial summary': { icon: ChartPie, tile: 'bg-tile-violet' },
};

const DEPARTMENTS: Record<string, GroupLook> = {
  academic: { icon: Buildings, tile: 'bg-tile-blue' },
  teaching: { icon: Chalkboard, tile: 'bg-tile-violet' },
  finance: { icon: Coins, tile: 'bg-tile-green' },
};

const FALLBACK: GroupLook = { icon: ChartBar, tile: 'bg-tile-blue' };

export const groupLook = (name: string): GroupLook => GROUPS[name.trim().toLowerCase()] ?? FALLBACK;
export const departmentLook = (id: string): GroupLook => DEPARTMENTS[id] ?? FALLBACK;
