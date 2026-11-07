import { useState, type ReactNode } from 'react';
import { CaretRight, UsersThree } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Student } from '../../../students/types';
import { classSectionLabel, fullName, initialsOf } from '../../../student-portal/utils/portalStudent';
import { ALL_CHILDREN, useParentPortal } from '../../context/ParentContext';
import { CHILD_FILLS } from './familyFormat';


const photoOf = (c: Student) => (c as Student & { photoUrl?: string | null }).photoUrl ?? null;

/** The child's photo, or their initials on their own colour. */
export function ChildAvatar({ child, index, className }: { child: Student; index: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const photo = photoOf(child);
  if (photo && !broken) {
    return <img src={photo} alt="" onError={() => setBroken(true)} className={cn('h-12 w-12 shrink-0 rounded-2xl object-cover', className)} />;
  }
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold text-tile-foreground', CHILD_FILLS[index % CHILD_FILLS.length], className)}>
      {initialsOf(child)}
    </span>
  );
}

/**
 * One child's part of an "All children" page: a big header (photo, name,
 * class) that opens that child's own page, then their content.
 */
export function ChildSection({ child, index, children, openLabel }: {
  child: Student; index: number; children: ReactNode; openLabel?: string;
}) {
  const { openChild } = useParentPortal();
  return (
    <section aria-label={fullName(child)} className="space-y-4 rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <Button
        variant="plain"
        type="button"
        onClick={() => openChild(child._id)}
        className="flex h-auto w-full items-center gap-3 rounded-2xl p-0 text-left whitespace-normal"
      >
        <ChildAvatar child={child} index={index} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold text-foreground sm:text-xl">{fullName(child)}</span>
          <span className="block truncate text-sm text-muted-foreground">{classSectionLabel(child)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground">
          <span className="hidden sm:inline">{openLabel ?? `Only ${child.firstName}`}</span>
          <span className="sm:hidden">Open</span>
          <CaretRight size={14} />
        </span>
      </Button>
      {children}
    </section>
  );
}

/**
 * "All children" then one button per child. Shown under the page title on
 * phones (the sidebar is hidden there) and in the staff banner.
 */
export function ChildSwitcher({ className, tone = 'plain' }: { className?: string; tone?: 'plain' | 'banner' }) {
  const { children, childId, allChildren, openChild } = useParentPortal();
  if (children.length < 2) return null;
  const chip = (selected: boolean) => cn(
    'flex h-auto shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-left transition-colors',
    tone === 'banner'
      ? selected ? 'bg-card shadow-sm ring-2 ring-primary/40' : 'bg-card/50 hover:bg-card/80'
      : selected ? 'bg-primary text-primary-foreground' : 'border border-border bg-card hover:bg-muted',
  );
  return (
    <div className={cn('flex gap-2 overflow-x-auto pb-1 scrollbar-thin', className)} role="group" aria-label="Choose a child">
      <Button variant="plain" type="button" onClick={() => openChild(ALL_CHILDREN)} aria-pressed={allChildren} className={chip(allChildren)}>
        <UsersThree size={18} weight={allChildren ? 'fill' : 'regular'} />
        <span className="text-sm font-semibold">All children</span>
      </Button>
      {children.map((c, i) => {
        const selected = !allChildren && c._id === childId;
        return (
          <Button key={c._id} variant="plain" type="button" onClick={() => openChild(c._id)} aria-pressed={selected} className={chip(selected)}>
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold text-tile-foreground', CHILD_FILLS[i % CHILD_FILLS.length])}>{initialsOf(c)}</span>
            <span className="text-sm font-semibold">{c.firstName}</span>
          </Button>
        );
      })}
    </div>
  );
}

/** A big, plain figure with a label underneath, for the family pages. */
export function BigFigure({ label, value, note, fill }: { label: string; value: ReactNode; note?: ReactNode; fill: string }) {
  return (
    <div className={cn('rounded-2xl p-3 text-tile-foreground', fill)}>
      <p className="text-sm font-medium leading-tight opacity-80">{label}</p>
      <div className="mt-0.5 break-words text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
      {note && <p className="mt-0.5 text-xs opacity-80">{note}</p>}
    </div>
  );
}
