import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { examsApi } from '../../../exams/api/examsApi';
import { ReportCardPanel } from '../../../exams/components/ReportCard';
import type { Student } from '../../../students/types';
import { Panel } from '../../../dashboard/components/DashboardKit';
import { parentPortalApi } from '../../api/parentPortalApi';
import { useParentPortal } from '../../context/ParentContext';
import { useFamilySummary } from '../../hooks/useFamilyResource';
import { LatestResult } from './FamilyDashboard';
import { ChildAvatar, ChildSection } from './FamilyKit';

function ChildReportCard({ child }: { child: Student }) {
  const { guardianId } = useParentPortal();
  const load = useCallback((termId?: string) => examsApi.parentPortalResults(child._id, guardianId, termId), [child._id, guardianId]);
  return <ReportCardPanel load={load} emptyText={`${child.firstName}'s results appear here once the school publishes them.`} />;
}

/** Every child's latest report card, one under the other. Each loads at the same time. */
export default function FamilyResults() {
  const { children, openChild } = useParentPortal();
  const { data } = useFamilySummary(parentPortalApi.getFamily);
  const latest = new Map((data?.children ?? []).map((c) => [c._id, c.latestResult]));
  return (
    <div className="space-y-5">
      {data && (
        <Panel title="Latest results" description="The newest term the school has published">
          <ul className="divide-y divide-border">
            {children.map((child, i) => {
              const result = latest.get(child._id) ?? null;
              return (
                <li key={child._id}>
                  <Button variant="plain" type="button" onClick={() => openChild(child._id)} className="flex h-auto w-full items-center gap-3 rounded-xl px-0 py-2.5 text-left whitespace-normal">
                    <ChildAvatar child={child} index={i} className="h-10 w-10 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{child.firstName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{result ? result.term.name : 'No results yet'}</span>
                    </span>
                    <LatestResult result={result} />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      {children.map((child, i) => (
        <ChildSection key={child._id} child={child} index={i}>
          <ChildReportCard child={child} />
        </ChildSection>
      ))}
    </div>
  );
}
