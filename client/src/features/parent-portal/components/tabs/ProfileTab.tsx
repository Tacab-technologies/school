import { Calendar, Envelope, GraduationCap, IdentificationCard, MapPin, Phone, User, UsersThree } from '@phosphor-icons/react';
import { EmptyState } from '@/components/common/EmptyState';
import { InfoGrid, ProfileSection } from '@/components/shared/ProfileKit';
import { useParentPortal } from '../../context/ParentContext';
import { classNameOf, sectionNameOf } from '../../../student-portal/utils/portalStudent';

const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

// The selected child is already a full Student record in context — no extra fetch.
export default function ProfileTab() {
  const { child } = useParentPortal();
  if (!child) return <EmptyState icon={User} tint="pink" title="No child selected" text="Pick a child above to see their details." />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ProfileSection icon={User} tint="blue" title="Personal" description="Name and birth details" className="h-full">
        <InfoGrid items={[
          { label: 'First name', value: child.firstName },
          { label: 'Last name', value: child.lastName },
          { label: 'Gender', value: child.gender },
          { label: 'Date of birth', value: formatDate(child.birthDate), icon: Calendar },
        ]} />
      </ProfileSection>

      <ProfileSection icon={GraduationCap} tint="green" title="School" description="Where they study" className="h-full">
        <InfoGrid items={[
          { label: 'Class', value: classNameOf(child) },
          { label: 'Section', value: sectionNameOf(child), empty: 'None' },
          { label: 'Admission number', value: child.admissionNumber, icon: IdentificationCard },
          { label: 'Status', value: child.status },
        ]} />
      </ProfileSection>

      <ProfileSection icon={UsersThree} tint="pink" title="Parent or guardian" description="Who the school contacts" className="h-full">
        <InfoGrid items={[
          { label: 'Name', value: child.parentName },
          { label: 'Phone', value: child.parentPhoneNumber, icon: Phone },
        ]} />
      </ProfileSection>

      <ProfileSection icon={MapPin} tint="yellow" title="Contact" description="The child's own contact details" className="h-full">
        <InfoGrid items={[
          { label: 'Phone', value: child.phoneNumber, icon: Phone },
          { label: 'Email', value: child.email, icon: Envelope },
          { label: 'Home address', value: child.address, icon: MapPin, wide: true },
        ]} />
      </ProfileSection>
    </div>
  );
}
