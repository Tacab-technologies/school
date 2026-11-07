import { DashboardError, DashboardLoading } from '../../../dashboard/components/DashboardKit';
import { AttendanceView } from '../../../student-portal/components/tabs/AttendanceTab';
import { parentPortalApi } from '../../api/parentPortalApi';
import { useChildResource } from '../../hooks/useChildResource';
import { useParentPortal } from '../../context/ParentContext';

/** The selected child's attendance: rate, a month calendar and every lesson marked. */
export default function AttendanceTab() {
  const { child } = useParentPortal();
  const { data, loading, error } = useChildResource(parentPortalApi.getChildAttendance);
  if (loading) return <DashboardLoading />;
  if (error) return <DashboardError message="Could not load the attendance." />;
  const first = child?.firstName ?? 'Your child';
  return (
    <AttendanceView
      records={data?.records ?? []}
      title={`${first}'s attendance`}
      emptyText={`No attendance has been recorded for ${first} yet.`}
      fileName={child ? `attendance-${child.firstName}-${child.lastName}` : 'attendance'}
    />
  );
}
