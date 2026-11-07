import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SquaresFour, User, CalendarCheck, CurrencyDollar, UserCircle, CaretLeft, Users, Exam } from '@phosphor-icons/react';
import { useAuth } from '../../../hooks/useAuth';
import type { Student } from '../../students/types';
import type { Parent } from '../../parents/types';
import { parentPortalApi } from '../api/parentPortalApi';
import { ParentProvider } from '../context/ParentContext';
import AdminParentSearch from './AdminParentSearch';
import ParentBanner, { ParentPageTitle } from '../components/ParentBanner';
import DashboardTab from '../components/tabs/DashboardTab';
import ProfileTab from '../components/tabs/ProfileTab';
import AttendanceTab from '../components/tabs/AttendanceTab';
import FeesTab from '../components/tabs/FeesTab';
import ResultsTab from '../components/tabs/ResultsTab';
import FamilyDashboard from '../components/family/FamilyDashboard';
import FamilyProfiles from '../components/family/FamilyProfiles';
import FamilyAttendance from '../components/family/FamilyAttendance';
import FamilyResults from '../components/family/FamilyResults';
import FamilyFees from '../components/family/FamilyFees';
import { TAB_IDS, type TabId } from '../types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/common/EmptyState';
import AccountSettings from '../../account/components/AccountSettings';
import { DashboardError, DashboardLoading } from '../../dashboard/components/DashboardKit';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: SquaresFour },
  { id: 'profile', label: 'Child details', icon: User },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'results', label: 'Results', icon: Exam },
  { id: 'fees', label: 'Fees & Payments', icon: CurrencyDollar },
];

/**
 * A parent moves between pages with the portal sidebar; staff viewing a
 * parent's portal keep the staff sidebar, so they get the pages as tabs here.
 */
function ParentPortalContent({ guardianId, showTabs }: { guardianId?: string; showTabs: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [children, setChildren] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const tabParam = searchParams.get('tab');
  const tab: TabId = (TAB_IDS as string[]).includes(tabParam ?? '') ? (tabParam as TabId) : 'dashboard';

  const setTab = (next: TabId) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('tab', next);
      return p;
    });

  const setChildId = (id: string) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('child', id);
      return p;
    });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const kids = await parentPortalApi.getChildren(guardianId);
        if (!cancelled) {
          setChildren(kids);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError('Could not load your children. Check your connection and refresh the page.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guardianId]);

  // A family with 2+ children starts on "All children"; one child is simply shown.
  const childParam = searchParams.get('child');
  const picked = children.some((c) => c._id === childParam) ? (childParam as string) : null;
  const allChildren = children.length > 1 && !picked;
  const childId = allChildren ? undefined : picked ?? children[0]?._id;
  const child = children.find((c) => c._id === childId) ?? null;
  const openChild = (id: string) => {
    setChildId(id);
    document.querySelector('main')?.scrollTo({ top: 0 });
  };

  // The parent's own account settings don't depend on a child.
  if (tab === 'settings' && !guardianId) return <AccountSettings />;

  if (loading) return <DashboardLoading />;
  if (error) return <DashboardError message={error} />;

  return (
    <ParentProvider value={{ guardianId, childId, child, children, allChildren, openChild }}>
      <div className="space-y-6">
        {showTabs ? <ParentBanner /> : <ParentPageTitle tab={tab} />}

        {children.length === 0 ? (
          <Card className="border-border">
            <EmptyState icon={Users} tint="pink" title="No students linked yet" text="No active students are linked to this parent or guardian yet. The school links children when they register them." />
          </Card>
        ) : (
          <>
            {showTabs && (
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="w-full print:hidden">
              <TabsList className="h-auto w-full justify-start overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger
                      key={t.id}
                      value={t.id}
                      className="gap-2 whitespace-nowrap"
                    >
                      <Icon size={16} />
                      <span>{t.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
            )}

            {allChildren ? (
              <>
                {tab === 'dashboard' && <FamilyDashboard onNavigate={setTab} />}
                {tab === 'profile' && <FamilyProfiles />}
                {tab === 'attendance' && <FamilyAttendance />}
                {tab === 'results' && <FamilyResults />}
                {tab === 'fees' && <FamilyFees />}
              </>
            ) : (
              <>
                {tab === 'dashboard' && <DashboardTab onNavigate={setTab} />}
                {tab === 'profile' && <ProfileTab />}
                {tab === 'attendance' && <AttendanceTab />}
                {tab === 'results' && <ResultsTab />}
                {tab === 'fees' && <FeesTab />}
              </>
            )}
          </>
        )}
      </div>
    </ParentProvider>
  );
}

function ViewingBanner({ parent, onChange }: { parent: Parent; onChange: () => void }) {
  return (
    <Card className="border-primary/30 bg-primary/5 shadow-2xs overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
            <UserCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                Viewing portal for <span className="text-primary">{parent.name}</span>
              </span>
              <Badge variant="outline" className="text-[10px] font-normal py-0">
                Staff Proxy View
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {parent.relationship || 'Guardian'} • {parent.phone} {parent.email ? `• ${parent.email}` : ''}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="xs"
          onClick={onChange}
          className="shrink-0 font-medium"
        >
          <CaretLeft size={13} /> Change Parent
        </Button>
      </div>
    </Card>
  );
}

export default function ParentPortalPage() {
  const { role } = useAuth();
  const isParent = role === 'parent';
  const [selectedParent, setSelectedParent] = useState<Parent | null>(null);

  // Admin/staff must pick a parent first; a logged-in parent sees their own family.
  if (!isParent && !selectedParent) {
    return <AdminParentSearch onSelect={setSelectedParent} />;
  }

  const guardianId = isParent ? undefined : selectedParent?._id;

  return (
    <div className="space-y-6">
      {!isParent && selectedParent && (
        <ViewingBanner parent={selectedParent} onChange={() => setSelectedParent(null)} />
      )}
      <ParentPortalContent guardianId={guardianId} showTabs={!isParent} />
    </div>
  );
}
