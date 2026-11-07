import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUUpLeft, ChartBar, ChartPie, Coins, DeviceMobile, Faders, GraduationCap, HandCoins, UsersThree, Wallet, type Icon } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/common/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { financeApi } from '../api/financeApi';
import { apiError } from '../api/monthlyFeesApi';
import CollectPaymentTab from '../components/CollectPaymentTab';
import ClassFeesStatusTab from '../components/ClassFeesStatusTab';
import FeeReportTab from '../components/FeeReportTab';
import ClassFeesPanel from '../components/ClassFeesPanel';
import PaymentMethodsPanel from '../components/PaymentMethodsPanel';
import ScholarshipsTab from '../components/ScholarshipsTab';
import ParentPaymentsTab from '../components/ParentPaymentsTab';
import FinanceOverviewTab from '../components/FinanceOverviewTab';
import SalariesTab from '../components/SalariesTab';
import ExpensesTab from '../components/ExpensesTab';
import RefundsTab from '../components/RefundsTab';
import { monthlyFeesApi } from '../api/monthlyFeesApi';
import type { PaymentMethod } from '../types';

type Tab = 'overview' | 'collect' | 'parents' | 'classes' | 'scholarships' | 'report' | 'salaries' | 'expenses' | 'refunds' | 'setup';

const TABS: { value: Tab; label: string; icon: Icon }[] = [
  { value: 'overview', label: 'Overview', icon: ChartPie },
  { value: 'collect', label: 'Collect Payment', icon: HandCoins },
  { value: 'parents', label: 'From Parents', icon: DeviceMobile },
  { value: 'classes', label: 'Class Status', icon: UsersThree },
  { value: 'scholarships', label: 'Scholarships', icon: GraduationCap },
  { value: 'report', label: 'Fee Report', icon: ChartBar },
  { value: 'salaries', label: 'Salaries', icon: Wallet },
  { value: 'expenses', label: 'Expenses', icon: Coins },
  { value: 'refunds', label: 'Refunds', icon: ArrowUUpLeft },
  { value: 'setup', label: 'Setup', icon: Faders },
];

// Salaries are private: only these roles can see them, whatever a custom role was given.
const SALARY_ROLES = ['admin', 'accountant'];

export default function FeeManagementPage() {
  const { showToast } = useToast();
  const { role } = useAuth();
  const tabs = TABS.filter((t) => t.value !== 'salaries' || SALARY_ROLES.includes(role ?? ''));
  const isTab = (v: string | null): v is Tab => tabs.some((t) => t.value === v);
  // The open tab lives in the URL (?tab=report) so a refresh or a shared link keeps it.
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : params.has('student') ? 'collect' : 'overview';
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  // A student picked on Class Status (or linked as ?student=), opened on Collect Payment.
  const [collectStudentId, setCollectStudentId] = useState<string | null>(() => params.get('student'));
  // A class clicked on the Overview, opened on Class Status.
  const [openClass, setOpenClass] = useState<{ classId: string; period: string | null } | null>(null);

  const loadMethods = useCallback(() => {
    financeApi.getPaymentMethods()
      .then(setPaymentMethods)
      .catch((err) => showToast(apiError(err, 'Could not load payment methods.'), 'error'));
  }, [showToast]);

  useEffect(() => { loadMethods(); }, [loadMethods]);

  // Payments parents sent from home that nobody has checked yet, shown on the tab.
  const [pendingFromParents, setPendingFromParents] = useState(0);
  useEffect(() => {
    monthlyFeesApi.listPaymentClaims('pending').then((d) => setPendingFromParents(d.pending)).catch(() => undefined);
  }, []);

  // ?student= is a one-off link (e.g. from the accountant dashboard): drop it once read,
  // so closing the panel and refreshing doesn't open that student again.
  useEffect(() => {
    if (!params.has('student')) return;
    const next = new URLSearchParams(params);
    next.delete('student');
    next.set('tab', 'collect');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const openTab = (value: string) => {
    if (!isTab(value)) return;
    if (value !== 'collect') setCollectStudentId(null);
    if (value !== 'classes') setOpenClass(null);
    setParams(value === 'overview' ? {} : { tab: value }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fees & Payments"
        subtitle="Collect fees, see who has paid, and keep track of the money coming in and going out."
      />

      <Tabs value={tab} onValueChange={openTab} className="space-y-5">
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-auto">
          {tabs.map(({ value, label, icon: TabIcon }) => (
            <TabsTrigger key={value} value={value} className="gap-2">
              <TabIcon size={16} />
              {label}
              {value === 'parents' && pendingFromParents > 0 && (
                <span className="rounded-full bg-tile-yellow px-1.5 text-[11px] font-semibold text-tile-foreground">{pendingFromParents}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <FinanceOverviewTab onOpenClass={(classId, period) => { setOpenClass({ classId, period }); setParams({ tab: 'classes' }, { replace: true }); }} />
        </TabsContent>

        <TabsContent value="collect" className="mt-0">
          <CollectPaymentTab paymentMethods={paymentMethods} initialStudentId={collectStudentId} />
        </TabsContent>

        <TabsContent value="parents" className="mt-0">
          <ParentPaymentsTab paymentMethods={paymentMethods} onChanged={setPendingFromParents} />
        </TabsContent>

        <TabsContent value="scholarships" className="mt-0">
          <ScholarshipsTab />
        </TabsContent>

        <TabsContent value="classes" className="mt-0">
          <ClassFeesStatusTab
            paymentMethods={paymentMethods}
            initialClassId={openClass?.classId}
            initialPeriod={openClass?.period}
            onCollect={(id) => { setCollectStudentId(id); openTab('collect'); }}
          />
        </TabsContent>

        <TabsContent value="report" className="mt-0">
          <FeeReportTab />
        </TabsContent>

        <TabsContent value="salaries" className="mt-0">
          <SalariesTab paymentMethods={paymentMethods} />
        </TabsContent>

        <TabsContent value="expenses" className="mt-0">
          <ExpensesTab paymentMethods={paymentMethods} />
        </TabsContent>

        <TabsContent value="refunds" className="mt-0">
          <RefundsTab paymentMethods={paymentMethods} />
        </TabsContent>

        <TabsContent value="setup" className="mt-0">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <ClassFeesPanel />
            <PaymentMethodsPanel methods={paymentMethods} onChanged={loadMethods} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
