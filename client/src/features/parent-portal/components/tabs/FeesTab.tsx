import { DashboardError, DashboardLoading } from '../../../dashboard/components/DashboardKit';
import { FeesView } from '../../../student-portal/components/tabs/FeesTab';
import { parentPortalApi } from '../../api/parentPortalApi';
import { useChildResource } from '../../hooks/useChildResource';
import { useParentPortal } from '../../context/ParentContext';
import PayFromHome from '../PayFromHome';

/** The selected child's bills, and paying from home. All children together: FamilyFees. */
export default function FeesTab() {
  const { child } = useParentPortal();
  const { data, loading, error } = useChildResource(parentPortalApi.getChildInvoices);
  if (loading) return <DashboardLoading />;
  if (error) return <DashboardError message="Could not load the fees." />;
  return (
    <div className="space-y-6">
    <FeesView
      data={data}
      title={child ? `${child.firstName}'s bills` : 'Bills'}
      emptyText="No bills yet. They appear here once the school charges the fees."
      fileName={child ? `fees-${child.firstName}-${child.lastName}` : 'fees'}
    >
      <PayFromHome balance={data?.totals?.balance ?? 0} />
    </FeesView>
    </div>
  );
}
