import { createContext, useContext } from 'react';
import type { Student } from '../../students/types';

interface ParentContextValue {
  // undefined → a logged-in parent viewing their own children (self routes)
  // set       → an admin/staff member viewing this specific guardian (id routes)
  guardianId?: string;
  // The currently selected child's id and record.
  childId?: string;
  child: Student | null;
  // All children linked to the (resolved) guardian.
  children: Student[];
  // "All children" view: every page shows every child together (child is null).
  allChildren: boolean;
  // Switch to one child (or ALL_CHILDREN), keeping the page.
  openChild: (id: string) => void;
}

// The ?child= value for the "All children" view.
export const ALL_CHILDREN = 'all';

const ParentContext = createContext<ParentContextValue>({ child: null, children: [], allChildren: false, openChild: () => undefined });

export const ParentProvider = ParentContext.Provider;
export const useParentPortal = () => useContext(ParentContext);
