import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SquaresFour, User, ClipboardText, CalendarBlank, CurrencyDollar, Gear, SidebarSimple, Exam, UserCircle, type Icon } from '@phosphor-icons/react';
import { onLogoError, useSchoolIdentity } from '../../features/settings/hooks/useSchoolIdentity';
import { Button } from '@/components/ui/button';
import ParentChildrenNav from './ParentChildrenNav';
import { cn } from '@/lib/utils';

type Item = { id: string; label: string; icon: Icon };

// Same look as the staff sidebar: one flat list, current page in pastel blue.
const STUDENT_NAV: Item[] = [
  { id: 'dashboard', label: 'Dashboard', icon: SquaresFour },
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'attendance', label: 'Attendance', icon: ClipboardText },
  { id: 'timetable', label: 'Timetable', icon: CalendarBlank },
  { id: 'results', label: 'Results', icon: Exam },
  { id: 'fees', label: 'Fees', icon: CurrencyDollar },
];

// A parent sees the same pages for the child picked at the top of the portal.
const PARENT_NAV: Item[] = [
  { id: 'dashboard', label: 'Dashboard', icon: SquaresFour },
  { id: 'profile', label: 'Child details', icon: UserCircle },
  { id: 'attendance', label: 'Attendance', icon: ClipboardText },
  { id: 'results', label: 'Results', icon: Exam },
  { id: 'fees', label: 'Fees & Payments', icon: CurrencyDollar },
];
const SETTINGS: Item = { id: 'settings', label: 'Settings', icon: Gear };

const PORTALS = {
  student: { path: '/student-portal', label: 'Student portal', nav: STUDENT_NAV },
  parent: { path: '/parent-portal', label: 'Parent portal', nav: PARENT_NAV },
};

interface Props {
  /** Which portal's pages to list. */
  portal?: keyof typeof PORTALS;
  onMobileClose?: () => void;
}

/** The left sidebar for students and parents: their portal's pages, Settings at the bottom. */
export default function StudentPortalSidebar({ portal = 'student', onMobileClose }: Props) {
  const { path, label, nav } = PORTALS[portal];
  const [collapsed, setCollapsed] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const active = searchParams.get('tab') || 'dashboard';
  const { schoolName, logoSrc } = useSchoolIdentity();

  const go = (id: string) => {
    // A parent stays on the same child when moving between pages.
    const child = searchParams.get('child');
    navigate(`${path}?tab=${id}${child ? `&child=${child}` : ''}`);
    onMobileClose?.();
  };

  const NavButton = ({ item }: { item: Item }) => {
    const isActive = active === item.id;
    const ItemIcon = item.icon;
    return (
      <Button
        variant="plain"
        type="button"
        onClick={() => go(item.id)}
        title={collapsed ? item.label : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex h-10 w-full items-center justify-start gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-tile-blue text-tile-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <ItemIcon size={18} weight={isActive ? 'fill' : 'regular'} className="shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Button>
    );
  };

  return (
    <aside className={cn('flex h-screen shrink-0 select-none flex-col border-r border-border bg-card transition-all duration-300', collapsed ? 'w-[72px]' : 'w-64')}>
      <div className={cn('flex h-16 shrink-0 items-center gap-3 px-4', collapsed && 'justify-center px-2')}>
        {!collapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <img
              src={logoSrc}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl object-contain"
              onError={onLogoError}
            />
            <div className="min-w-0">
              <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground">{schoolName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{label}</p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <SidebarSimple size={18} />
        </Button>
      </div>

      {portal === 'parent' && (
        <div className="shrink-0 border-b border-border pb-3 pt-1">
          <ParentChildrenNav collapsed={collapsed} onPicked={onMobileClose} />
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 pt-2 scrollbar-thin">
        {nav.map((item) => <NavButton key={item.id} item={item} />)}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <NavButton item={SETTINGS} />
      </div>
    </aside>
  );
}
