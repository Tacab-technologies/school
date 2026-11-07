import * as React from 'react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from './select';

/*
 * A dropdown in the app's own style, written like a plain <select>:
 *
 *   <NativeSelect value={x} onChange={(e) => setX(e.target.value)}>
 *     <option value="" disabled>Choose a class</option>
 *     <option value="a">Grade 5</option>
 *   </NativeSelect>
 *
 * The browser's own list can't be styled, so the <option>/<optgroup> children
 * are read and shown in the app's dropdown (the one in ./select) instead.
 * onChange still gets an event-like object whose target.value is the choice.
 *
 * - An option with value "" that is disabled, hidden, or reads "Select…" /
 *   "Choose…" / "Pick…" is the placeholder. Any other empty one ("All
 *   classes", "None") is a normal choice.
 * - `name` puts the value in a hidden input, so forms read with FormData work.
 * - `required` blocks the submit while empty and shows "Choose one.".
 */

export interface NativeSelectProps extends Omit<React.ComponentProps<'select'>, 'ref'> {
  containerClassName?: string;
}

interface Option { value: string; label: React.ReactNode; text: string; disabled: boolean; hidden: boolean }
interface Group { label?: string; options: Option[] }

// Radix doesn't allow "" as an item value, so "" travels under this name.
const EMPTY = '__empty__';
const toItem = (v: string) => (v === '' ? EMPTY : v);
const fromItem = (v: string) => (v === EMPTY ? '' : v);

const textOf = (node: React.ReactNode): string =>
  React.Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : React.isValidElement(c) ? textOf((c.props as { children?: React.ReactNode }).children) : '')).join('');

/** The <option>s and <optgroup>s inside `children`, through fragments and arrays. */
function readOptions(children: React.ReactNode): Group[] {
  const groups: Group[] = [{ options: [] }];
  const walk = (nodes: React.ReactNode, into: Group) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean; hidden?: boolean; label?: string };
      if (child.type === React.Fragment) return walk(props.children, into);
      // A small helper that only returns <option>s (e.g. <RoleOptions roles={…} />):
      // read what it returns. Helpers must not use hooks for this to work.
      if (typeof child.type === 'function') {
        try {
          return walk((child.type as (p: unknown) => React.ReactNode)(child.props), into);
        } catch {
          return undefined;
        }
      }
      if (child.type === 'optgroup') {
        const group: Group = { label: props.label, options: [] };
        groups.push(group);
        walk(props.children, group);
        return;
      }
      if (child.type === 'option') {
        const text = textOf(props.children);
        into.options.push({
          value: props.value === undefined || props.value === null ? text : String(props.value),
          label: props.children,
          text,
          disabled: !!props.disabled,
          hidden: !!props.hidden,
        });
      }
    });
  };
  walk(children, groups[0]);
  return groups.filter((g) => g.options.length > 0);
}

const NativeSelect = React.forwardRef<HTMLButtonElement, NativeSelectProps>(
  ({ className, containerClassName, children, value, defaultValue, onChange, name, required, disabled, id, title, autoFocus, ...rest }, ref) => {
    // Keep the width the caller asked for on the outer box.
    const widthMatch = className?.match(/\b((?:w|min-w|max-w)-(?:\[[^\]]+\]|[^\s]+)|flex-1|shrink-0)\b/g);
    const widthClasses = widthMatch ? widthMatch.join(' ') : 'w-full';

    const controlled = value !== undefined;
    const [inner, setInner] = React.useState(() => String(defaultValue ?? ''));
    const current = controlled ? String(value ?? '') : inner;
    const [missing, setMissing] = React.useState(false);
    React.useEffect(() => { if (current) setMissing(false); }, [current]);

    const groups = React.useMemo(() => readOptions(children), [children]);
    const all = groups.flatMap((g) => g.options);
    // The empty choice that only says "Choose ..." is the placeholder, not a row in the list.
    const placeholder = all.find((o) => o.value === '' && (o.disabled || o.hidden || /^(select|choose|pick)\b/i.test(o.text.trim())));
    const shown = groups
      .map((g) => ({ ...g, options: g.options.filter((o) => o !== placeholder && !o.hidden) }))
      .filter((g) => g.options.length > 0);
    const known = all.some((o) => o.value === current && o !== placeholder);

    const pick = (next: string) => {
      const v = fromItem(next);
      if (!controlled) setInner(v);
      const target = { value: v, name: name ?? '', id: id ?? '' };
      onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
    };

    const ariaLabel = rest['aria-label'];
    const ariaLabelledBy = rest['aria-labelledby'];
    const ariaInvalid = rest['aria-invalid'];

    return (
      <div className={cn('relative', widthClasses, containerClassName)}>
        <Select value={known ? toItem(current) : ''} onValueChange={pick} disabled={disabled}>
          <SelectTrigger
            ref={ref}
            id={id}
            title={title}
            autoFocus={autoFocus}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-invalid={ariaInvalid ?? (missing || undefined)}
            aria-required={required || undefined}
            className={cn(missing && 'border-destructive focus-visible:ring-destructive/40', className)}
          >
            <SelectValue placeholder={placeholder?.label ?? (current && !known ? current : 'Choose…')} />
          </SelectTrigger>
          <SelectContent>
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nothing to choose yet.</p>}
            {shown.map((g, gi) => (
              <React.Fragment key={g.label ?? `group-${gi}`}>
                {gi > 0 && !g.label && <SelectSeparator />}
                <SelectGroup>
                  {g.label && <SelectLabel>{g.label}</SelectLabel>}
                  {g.options.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={toItem(o.value)} disabled={o.disabled} textValue={o.text}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </React.Fragment>
            ))}
          </SelectContent>
        </Select>
        {name && <input type="hidden" name={name} value={current} />}
        {required && (
          // Lets the form's own "required" check stop an empty submit, then flags the field.
          <input
            tabIndex={-1}
            aria-hidden
            required
            value={current}
            onChange={() => undefined}
            onInvalid={(e) => { e.preventDefault(); setMissing(true); }}
            className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0"
          />
        )}
        {missing && <p className="mt-1 text-xs text-destructive">Choose one.</p>}
      </div>
    );
  },
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
