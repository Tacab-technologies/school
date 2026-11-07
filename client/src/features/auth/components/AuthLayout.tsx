import type { ReactNode } from 'react';
import { CalendarCheck, ChartBar, Coins } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { onLogoError, useSchoolIdentity } from '../../settings/hooks/useSchoolIdentity';

/** The school's logo and name, as shown above the sign-in form. */
export function SchoolMark({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const { schoolName, logoSrc } = useSchoolIdentity();
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className={cn('flex shrink-0 items-center justify-center rounded-2xl bg-card shadow-sm ring-1 ring-border/60', size === 'lg' ? 'h-12 w-12' : 'h-10 w-10')}>
        <img src={logoSrc} alt="" onError={onLogoError} className={cn('object-contain', size === 'lg' ? 'h-9 w-9' : 'h-7 w-7')} />
      </span>
      <span className="text-sm font-semibold leading-tight text-foreground">{schoolName}</span>
    </div>
  );
}

const HIGHLIGHTS = [
  { icon: CalendarCheck, label: 'Attendance' },
  { icon: ChartBar, label: 'Results' },
  { icon: Coins, label: 'Fees' },
];

/**
 * Sign-in layout: on large screens the school photo fills the left 60% from
 * edge to edge, with the school's name over a dark fade at the bottom; the
 * form sits in the remaining 40%. Phones get the form alone.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const { schoolName, logoSrc } = useSchoolIdentity();
  return (
    <div className="flex min-h-dvh w-full bg-background">
      <aside className="relative hidden w-[60%] shrink-0 overflow-hidden bg-gradient-to-br from-tile-green via-tile-blue to-tile-violet lg:block">
        <img src="/Images/Left%20side%20image.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        {/* Darker at the bottom so the caption stays readable on any photo. */}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/5" />

        <div className="absolute left-10 top-10 flex items-center gap-3 rounded-2xl bg-white/15 px-3 py-2 backdrop-blur-md ring-1 ring-white/25">
          <img src={logoSrc} alt="" onError={onLogoError} className="h-8 w-8 rounded-lg bg-white/90 object-contain p-0.5" />
          <span className="text-sm font-semibold text-white">{schoolName}</span>
        </div>

        <div className="absolute inset-x-10 bottom-12 max-w-xl text-white">
          <p className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Learning, together.</p>
          <p className="mt-3 text-base text-white/80">
            Teachers, families and the school office, in one place.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur-md ring-1 ring-white/25">
                <Icon size={16} weight="duotone" /> {label}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-1 flex-col px-5 py-8 sm:px-10 xl:px-14">
        {/* The photo panel already shows the school's name on large screens. */}
        <SchoolMark className="lg:invisible" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <p className="text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {schoolName}</p>
      </main>
    </div>
  );
}
