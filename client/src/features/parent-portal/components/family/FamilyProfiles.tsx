import { Calendar, IdentificationCard } from '@phosphor-icons/react';
import { InfoGrid } from '@/components/shared/ProfileKit';
import { useParentPortal } from '../../context/ParentContext';
import { classNameOf, sectionNameOf } from '../../../student-portal/utils/portalStudent';
import { ChildSection } from './FamilyKit';

const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/** Each child's key details. The records are already loaded with the family. */
export default function FamilyProfiles() {
  const { children } = useParentPortal();
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {children.map((child, i) => (
        <ChildSection key={child._id} child={child} index={i} openLabel="All details">
          <InfoGrid items={[
            { label: 'Class', value: classNameOf(child) },
            { label: 'Section', value: sectionNameOf(child), empty: 'None' },
            { label: 'Admission number', value: child.admissionNumber, icon: IdentificationCard },
            { label: 'Date of birth', value: formatDate(child.birthDate), icon: Calendar },
            { label: 'Gender', value: child.gender },
            { label: 'Status', value: child.status },
          ]} />
        </ChildSection>
      ))}
    </div>
  );
}
