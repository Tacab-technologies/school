import { Button } from '@/components/ui/button';
import { DashboardError, DashboardLoading, Panel } from '../../../dashboard/components/DashboardKit';
import { FeesView } from '../../../student-portal/components/tabs/FeesTab';
import { parentPortalApi, type FamilySummary } from '../../api/parentPortalApi';
import { useParentPortal } from '../../context/ParentContext';
import { useFamilyResource, useFamilySummary } from '../../hooks/useFamilyResource';
import PayFromHome from '../PayFromHome';
import { ChildAvatar, ChildSection } from './FamilyKit';
import { formatUSD } from './familyFormat';

/** Every child's fees side by side, with the family's total. One row per child, readable on a phone. */
export function FamilyFeesTable({ family }: { family: FamilySummary }) {
  const { children, openChild } = useParentPortal();
  const order = new Map(children.map((c, i) => [c._id, i]));
  return (
    <Panel title="Family fees" description="All your children's fees together">
      <ul className="divide-y divide-border">
        {family.children.map((row) => {
          const child = children.find((c) => c._id === row._id);
          return (
            <li key={row._id} className="flex items-center gap-3 py-3">
              {child && <ChildAvatar child={child} index={order.get(row._id) ?? 0} className="h-10 w-10 text-sm" />}
              <div className="min-w-0 flex-1">
                <Button variant="plain" type="button" onClick={() => openChild(row._id)} className="block h-auto max-w-full truncate p-0 text-left text-base font-semibold text-foreground hover:underline">
                  {row.name}
                </Button>
                <p className="text-xs text-muted-foreground">Billed {formatUSD(row.fees.invoiced)} · Paid {formatUSD(row.fees.paid)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">Still to pay</p>
                <p className="text-lg font-bold tabular-nums">{formatUSD(row.fees.balance)}</p>
              </div>
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="font-semibold">Family total</p>
            <p className="text-xs text-muted-foreground">Billed {formatUSD(family.totals.invoiced)} · Paid {formatUSD(family.totals.paid)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Still to pay</p>
            <p className="text-xl font-bold tabular-nums">{formatUSD(family.totals.balance)}</p>
          </div>
        </li>
      </ul>
    </Panel>
  );
}

/** The family's fees: the totals, one Pay from home for everyone, then each child's bills. */
export default function FamilyFees() {
  const { children } = useParentPortal();
  const family = useFamilySummary(parentPortalApi.getFamily);
  const { items, loading } = useFamilyResource(parentPortalApi.getChildInvoices);
  if (family.loading) return <DashboardLoading />;
  if (family.error || !family.data) return <DashboardError message="Could not load the fees." />;

  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <FamilyFeesTable family={family.data} />
        <PayFromHome balance={family.data.totals.balance} />
      </div>

      {loading ? <DashboardLoading /> : children.map((child, i) => {
        const item = items[child._id];
        return (
          <ChildSection key={child._id} child={child} index={i}>
            {item?.error ? (
              <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Could not load {child.firstName}'s bills. Refresh the page to try again.</p>
            ) : (
              <FeesView
                data={item?.data ?? null}
                title={`${child.firstName}'s bills`}
                emptyText="No bills yet. They appear here once the school charges the fees."
                fileName={`fees-${child.firstName}-${child.lastName}`}
              />
            )}
          </ChildSection>
        );
      })}
    </div>
  );
}
