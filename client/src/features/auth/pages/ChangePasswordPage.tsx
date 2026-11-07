import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, Circle, Eye, EyeSlash, Lock, SignOut, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '../../../store/authStore';
import { homePathFor } from '../../../hooks/usePermission';
import { authApi } from '../api/authApi';
import AuthLayout from '../components/AuthLayout';

const MIN_LENGTH = 8;

function PasswordField({ id, label, value, onChange, show, autoComplete, autoFocus, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; show: boolean;
  autoComplete: string; autoFocus?: boolean; placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <Lock size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} type={show ? 'text' : 'password'} required autoFocus={autoFocus} value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete}
          className="h-12 rounded-xl pl-11 text-[15px]" />
      </div>
    </div>
  );
}

/**
 * "Choose your own password": shown after signing in with a password the
 * school office gave (a new login or a reset). Nothing else in the app opens
 * until it is done (see ProtectedRoute and the server's authenticate).
 */
export default function ChangePasswordPage() {
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const updateUser = useAuthStore((s) => s.updateUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Already done (or opened by typing the address): carry on to the home page.
  if (!user?.mustChangePassword) return <Navigate to={homePathFor(user)} replace />;

  const rules = [
    { ok: next.length >= MIN_LENGTH, text: `At least ${MIN_LENGTH} characters` },
    { ok: next.length > 0 && next !== current, text: 'Different from the password you were given' },
    { ok: confirm.length > 0 && confirm === next, text: 'Both new passwords match' },
  ];
  const canSave = current.length > 0 && rules.every((r) => r.ok) && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setError('');
    setSaving(true);
    try {
      await authApi.changePassword({ currentPassword: current, newPassword: next, refreshToken });
      updateUser({ mustChangePassword: false });
      showToast('Your new password is saved. Use it next time you sign in.');
      navigate(homePathFor(user), { replace: true });
    } catch (err: any) {
      if (err?.response) {
        const message: string | undefined = err.response.data?.message;
        setError(message === 'Current password is incorrect'
          ? "The password you were given doesn't match. Type it exactly as it was given to you."
          : message || 'Could not save your new password. Try again.');
      } else {
        setError("Can't reach the server. Check your internet connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  function signOut() {
    authApi.logout(refreshToken).catch(() => {});
    clearAuth();
    navigate('/login', { replace: true });
  }

  return (
    <AuthLayout>
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Choose your own password</h1>
          <p className="text-sm text-muted-foreground">
            Welcome{user.name ? `, ${user.name}` : ''}. You signed in with a password from the school office.
            Pick a new one that only you know before you continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <PasswordField id="pw-current" label="Password you were given" value={current} onChange={setCurrent} show={show}
            autoComplete="current-password" autoFocus placeholder="The temporary password" />
          <PasswordField id="pw-new" label="New password" value={next} onChange={setNext} show={show}
            autoComplete="new-password" placeholder="Your new password" />
          <PasswordField id="pw-confirm" label="Type the new password again" value={confirm} onChange={setConfirm} show={show}
            autoComplete="new-password" placeholder="The same new password" />

          <div className="flex items-start justify-between gap-3">
            <ul className="space-y-1.5 text-sm" aria-label="Password rules">
              {rules.map((rule) => (
                <li key={rule.text} className={cn('flex items-center gap-2', rule.ok ? 'text-success' : 'text-muted-foreground')}>
                  {rule.ok ? <CheckCircle size={16} weight="fill" /> : <Circle size={16} />}
                  {rule.text}
                </li>
              ))}
            </ul>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShow(!show)} className="shrink-0">
              {show ? <EyeSlash size={16} /> : <Eye size={16} />} {show ? 'Hide' : 'Show'}
            </Button>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <WarningCircle size={18} className="mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button size="lg" type="submit" disabled={!canSave} className="h-12 w-full text-[15px]">
            {saving ? <><SpinnerGap size={18} className="animate-spin" /> Saving…</> : <>Save and continue <ArrowRight size={18} /></>}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3.5 text-sm text-muted-foreground">
          <span>Not you, or want to do this later?</span>
          <Button type="button" variant="ghost" size="sm" onClick={signOut}>
            <SignOut size={16} /> Sign out
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
