import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativeSelect } from './native-select';

// Options given through a small helper component, in groups, as the user form does.
function RoleOptions({ roles }: { roles: { key: string; name: string; builtIn: boolean }[] }) {
  return (
    <>
      <optgroup label="Built-in roles">
        {roles.filter((r) => r.builtIn).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
      </optgroup>
      <optgroup label="Custom roles">
        {roles.filter((r) => !r.builtIn).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
      </optgroup>
    </>
  );
}

const roles = [
  { key: 'admin', name: 'Admin', builtIn: true },
  { key: 'accountant', name: 'Accountant', builtIn: true },
  { key: 'secretary', name: 'Secretary', builtIn: false },
];

describe('NativeSelect', () => {
  // Radix measures and scrolls the list; jsdom has neither.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();

  it('lists options that come from a helper component, in their groups', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <NativeSelect aria-label="Role" value="" onChange={onChange}>
        <option value="" disabled>Choose a role</option>
        <RoleOptions roles={roles} />
      </NativeSelect>,
    );

    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Choose a role');
    await user.click(screen.getByRole('combobox', { name: 'Role' }));
    expect(screen.getByText('Built-in roles')).toBeInTheDocument();
    expect(screen.getByText('Custom roles')).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Admin', 'Accountant', 'Secretary']);

    await user.click(screen.getByRole('option', { name: 'Secretary' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'secretary' }) }));
  });
});
