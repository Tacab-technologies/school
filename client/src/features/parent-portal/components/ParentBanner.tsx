import { GraduationCap, IdentificationCard, UsersThree } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useParentPortal } from '../context/ParentContext';
import { fullName, initialsOf, classSectionLabel } from '../../student-portal/utils/portalStudent';
import { ChildSwitcher } from './family/FamilyKit';

/**
 * The top of the parent portal for staff viewing a parent: a pastel card about
 * the child being viewed (or all of them), with "All children" and a button per
 * child to switch.
 */
export default function ParentBanner() {
  const { children, child, allChildren } = useParentPortal();

  if (allChildren) {
    return (
      <section className="space-y-4 rounded-3xl bg-gradient-to-br from-tile-pink via-tile-violet to-tile-blue p-5 text-tile-foreground print:hidden sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">All {children.length} children</h1>
          <p className="mt-1 text-sm opacity-80">Every child together. Tap a name to see only that child.</p>
        </div>
        <ChildSwitcher tone="banner" />
      </section>
    );
  }

  if (!child) {
    return (
      <section className="rounded-3xl bg-gradient-to-br from-tile-pink via-tile-violet to-tile-blue p-6 text-tile-foreground">
        <h1 className="text-2xl font-bold tracking-tight">Parent portal</h1>
        <p className="mt-1 text-sm opacity-80">Your children's attendance, results and fees.</p>
      </section>
    );
  }

  const active = child.status?.toLowerCase() === 'active';

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-tile-pink via-tile-violet to-tile-blue p-5 text-tile-foreground print:hidden sm:p-6">
      <span aria-hidden className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-card/25 blur-2xl" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-card text-xl font-bold shadow-sm ring-4 ring-card/40 sm:h-20 sm:w-20 sm:text-2xl">
            {initialsOf(child)}
          </span>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{fullName(child)}</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-0.5 text-xs font-semibold">
                <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-success' : 'bg-warning')} />
                {child.status || 'Active'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-1 text-xs font-medium">
                <GraduationCap size={13} className="opacity-70" /> {classSectionLabel(child)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-1 text-xs font-medium">
                <IdentificationCard size={13} className="opacity-70" /> {child.admissionNumber}
              </span>
            </div>
          </div>
        </div>

        {children.length > 1 && (
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
              <UsersThree size={14} /> Your children · tap to switch
            </p>
            <ChildSwitcher tone="banner" />
          </div>
        )}
      </div>
    </section>
  );
}

const PAGE_TITLE: Record<string, (first: string) => string> = {
  dashboard: (n) => `${n}'s overview`,
  profile: (n) => `About ${n}`,
  attendance: (n) => `${n}'s attendance`,
  results: (n) => `${n}'s results`,
  fees: (n) => `${n}'s fees & payments`,
};

const ALL_TITLE: Record<string, string> = {
  dashboard: 'All your children',
  profile: "Your children's details",
  attendance: 'Attendance · all children',
  results: 'Results · all children',
  fees: 'Fees & payments · all children',
};

/**
 * The parent's own pages start with this small title. The child is picked in
 * the sidebar, so the big card (kept for staff viewing a parent) isn't needed.
 * On phones (no sidebar) it carries the child switcher itself.
 */
export function ParentPageTitle({ tab }: { tab: string }) {
  const { child, children, allChildren } = useParentPortal();
  if (allChildren) {
    return (
      <div className="space-y-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{ALL_TITLE[tab] ?? ALL_TITLE.dashboard}</h1>
          <p className="mt-1 text-base text-muted-foreground">{children.length} children together. Tap a name to see only that child.</p>
        </div>
        <ChildSwitcher className="lg:hidden" />
      </div>
    );
  }
  if (!child) return null;
  const active = child.status?.toLowerCase() === 'active';
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {(PAGE_TITLE[tab] ?? PAGE_TITLE.dashboard)(child.firstName)}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><GraduationCap size={15} /> {classSectionLabel(child)}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5"><IdentificationCard size={15} /> {child.admissionNumber}</span>
          {!active && (
            <span className="rounded-full bg-tile-yellow px-2 py-0.5 text-xs font-medium text-tile-foreground">{child.status}</span>
          )}
        </p>
      </div>
      {/* On phones the sidebar is hidden, so the children are picked here. */}
      <ChildSwitcher className="w-full lg:hidden" />
    </div>
  );
}
