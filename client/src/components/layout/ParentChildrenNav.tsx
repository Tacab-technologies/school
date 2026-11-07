import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Student } from '../../features/students/types';
import { parentPortalApi } from '../../features/parent-portal/api/parentPortalApi';
import { classSectionLabel, initialsOf } from '../../features/student-portal/utils/portalStudent';
import { ALL_CHILDREN } from '../../features/parent-portal/context/ParentContext';
import { CHILD_FILLS as FILLS } from '../../features/parent-portal/components/family/familyFormat';

/**
 * "Your children" at the top of the parent sidebar: "All children" first (the
 * default with two or more), then one row per child, the one being viewed
 * highlighted. Tapping keeps the page and switches the child.
 */
export default function ParentChildrenNav({ collapsed, onPicked }: { collapsed: boolean; onPicked?: () => void }) {
  const [children, setChildren] = useState<Student[]>([]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    parentPortalApi.getChildren().then(setChildren).catch(() => undefined);
  }, []);

  if (children.length === 0) return null;
  const param = searchParams.get('child');
  const current = children.some((c) => c._id === param) ? param : children.length > 1 ? ALL_CHILDREN : children[0]._id;
  // One child: nothing to switch, just show who it is.
  const rows = children.length > 1 ? [ALL_CHILDREN, ...children.map((c) => c._id)] : [children[0]._id];

  const pick = (id: string) => {
    const tab = searchParams.get('tab');
    navigate(`/parent-portal?${tab && tab !== 'settings' ? `tab=${tab}&` : ''}child=${id}`);
    onPicked?.();
  };

  return (
    <div className={cn('space-y-1', collapsed ? 'px-2' : 'px-3')}>
      {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your children</p>}
      {rows.map((id) => {
        const active = id === current;
        const i = children.findIndex((c) => c._id === id);
        const c = children[i];
        const label = c ? `${c.firstName} ${c.lastName}` : 'All children';
        return (
          <Button
            key={id}
            variant="plain"
            type="button"
            onClick={() => pick(id)}
            aria-pressed={active}
            title={collapsed ? label : undefined}
            className={cn(
              'flex h-auto w-full items-center gap-3 rounded-xl p-2 text-left transition-colors',
              collapsed && 'justify-center p-1.5',
              active ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/60',
            )}
          >
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-tile-foreground', c ? FILLS[i % FILLS.length] : 'bg-muted text-foreground', active && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-card')}>
              {c ? initialsOf(c) : <UsersThree size={18} weight={active ? 'fill' : 'regular'} />}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>{c ? c.firstName : 'All children'}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{c ? classSectionLabel(c) : `${children.length} together`}</span>
              </span>
            )}
            {!collapsed && active && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
          </Button>
        );
      })}
    </div>
  );
}
