import { useMemo, useState } from "react";
import { CheckSquare } from "@phosphor-icons/react";
import { teachersApi } from "../api/teachersApi";
import type { TeacherAssignment } from "../types";
import type { Class, Section, Subject, Term } from "../../academic-structure/types";
import { assignmentsByCell, buildGrid, cellKey, cellsOfColumn, cellsOfRow, toggleGroup, toItem } from "../quickAssign";
import { termLabel } from "./AssignmentFormModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmAction } from "@/components/common/ConfirmDialog";
import { useToast } from "@/hooks/use-toast";

const assignmentName = (a: TeacherAssignment) =>
  `${a.subjectId?.sub_name ?? "Subject"} (${a.classId?.cl_name ?? "class"}${a.sectionId?.name ? ` ${a.sectionId.name}` : ""})`;

// How much of a group is ticked, for its "whole row / whole column" box.
const groupState = (ticked: Set<string>, cells: string[]) => {
  const count = cells.filter((cell) => ticked.has(cell)).length;
  if (count === 0) return false;
  return count === cells.length ? true : "indeterminate";
};

/**
 * Give a teacher their classes and subjects by ticking boxes, for one term.
 * Boxes already ticked are what they teach now; unticking one removes it. Lessons
 * on the timetable are set afterwards, from each assignment's own form.
 */
export default function QuickAssignDrawer({
  teacherId, teacherName, assignments, classes, sections, subjects, terms, onClose, onSaved,
}: {
  teacherId: string;
  teacherName: string;
  assignments: TeacherAssignment[];
  classes: Class[];
  sections: Section[];
  subjects: Subject[];
  terms: Term[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [termId, setTermId] = useState((terms.find((t) => t.status === "active") ?? terms[0])?._id ?? "");
  const saved = useMemo(() => assignmentsByCell(assignments, termId), [assignments, termId]);
  const [ticked, setTicked] = useState(() => new Set(saved.keys()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { rows, columns } = useMemo(() => buildGrid(classes, sections, subjects), [classes, sections, subjects]);
  const cellsInGrid = useMemo(() => new Set(rows.flatMap(cellsOfRow)), [rows]);
  // Saved assignments with no box, because the class or subject has changed since. They are kept.
  const offGrid = [...saved].filter(([cell]) => !cellsInGrid.has(cell));

  const toAdd = [...ticked].filter((cell) => !saved.has(cell));
  const toRemove = [...saved].filter(([cell]) => cellsInGrid.has(cell) && !ticked.has(cell)).map(([, a]) => a);
  const changed = toAdd.length > 0 || toRemove.length > 0;

  const chooseTerm = (id: string) => {
    setTermId(id);
    setTicked(new Set(assignmentsByCell(assignments, id).keys()));
    setError("");
  };
  const toggleCell = (cell: string) => setTicked((current) => {
    const next = new Set(current);
    if (!next.delete(cell)) next.add(cell);
    return next;
  });

  async function save() {
    const withLessons = toRemove.filter((a) => a.timetableSlots?.length);
    if (withLessons.length && !(await confirmAction({
      title: `Remove ${withLessons.length === 1 ? "a class" : `${withLessons.length} classes`} with lessons on the timetable?`,
      text: `${withLessons.map(assignmentName).join(", ")} ${withLessons.length === 1 ? "has" : "have"} lessons on the timetable. Unticking takes them off.`,
      confirmLabel: "Remove and save",
      tone: "danger",
    }))) return;

    setSaving(true);
    setError("");
    try {
      // Assignments with no box are in `ticked` from the start, so they are sent too and stay.
      const result = await teachersApi.saveAssignments(teacherId, { termId, items: [...ticked].map(toItem) });
      showToast(`Saved: ${result.added} added, ${result.removed} removed.`);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Can't reach the server. Check your internet connection and try again.");
      setSaving(false);
    }
  }

  async function close() {
    if (changed && !(await confirmAction({
      title: "Discard these changes?",
      text: "The boxes you changed have not been saved.",
      confirmLabel: "Discard",
    }))) return;
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader icon={CheckSquare} tint="green">
          <DialogTitle>Tick classes and subjects</DialogTitle>
          <DialogDescription>
            Tick what {teacherName} teaches this term. Untick a box to remove it. Lessons on the timetable are set later, from the pencil on each class.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="quick-assign-term" className="text-xs font-semibold">Term</Label>
          <NativeSelect id="quick-assign-term" value={termId} onChange={(e) => chooseTerm(e.target.value)} className="h-10 rounded-xl bg-muted/40 text-sm">
            {terms.length === 0 && <option value="">No terms yet</option>}
            {terms.map((t) => <option key={t._id} value={t._id}>{termLabel(t)}{t.status === "active" ? " · active" : ""}</option>)}
          </NativeSelect>
        </div>

        {rows.length === 0 || columns.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
            Add classes and their subjects in Academic Structure first.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead scope="col" className="sticky left-0 z-10 h-auto min-w-40 bg-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Class</TableHead>
                  <TableHead scope="col" className="h-auto px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider">All</TableHead>
                  {columns.map((subject) => {
                    const cells = cellsOfColumn(rows, subject._id);
                    return (
                      <TableHead key={subject._id} scope="col" className="h-auto min-w-20 px-2 py-2 text-center text-xs font-semibold">
                        <span className="mb-1.5 block whitespace-nowrap">{subject.sub_name}</span>
                        <Checkbox aria-label={`Tick ${subject.sub_name} in every class`} checked={groupState(ticked, cells)}
                          onCheckedChange={() => setTicked((current) => toggleGroup(current, cells))} />
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const cells = cellsOfRow(row);
                  return (
                    <TableRow key={row.key}>
                      <TableHead scope="row" className="sticky left-0 z-10 h-auto whitespace-nowrap bg-card px-3 py-2 text-left font-medium text-foreground">{row.label}</TableHead>
                      <TableCell className="px-2 py-2 text-center">
                        <Checkbox aria-label={`Tick every subject in ${row.label}`} checked={groupState(ticked, cells)} disabled={cells.length === 0}
                          onCheckedChange={() => setTicked((current) => toggleGroup(current, cells))} />
                      </TableCell>
                      {columns.map((subject) => {
                        if (!row.subjectIds.has(subject._id)) {
                          return <TableCell key={subject._id} className="px-2 py-2 text-center text-muted-foreground/50" title={`${row.label} doesn't take ${subject.sub_name}`}>–</TableCell>;
                        }
                        const cell = cellKey(row.classId, row.sectionId, subject._id);
                        const lessons = saved.get(cell)?.timetableSlots?.length ?? 0;
                        return (
                          <TableCell key={subject._id} className="px-2 py-2 text-center" title={lessons ? `${lessons} lesson${lessons === 1 ? "" : "s"} a week on the timetable` : undefined}>
                            <Checkbox aria-label={`${subject.sub_name} in ${row.label}`} checked={ticked.has(cell)} onCheckedChange={() => toggleCell(cell)} />
                            {lessons > 0 && <span className="ml-1 align-top text-[10px] tabular-nums text-muted-foreground">{lessons}</span>}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          A small number beside a box is that class's lessons a week on the timetable. A dash means the class doesn't take that subject.
        </p>

        {offGrid.length > 0 && (
          <p className="rounded-xl bg-tile-yellow px-3.5 py-2.5 text-xs text-tile-foreground">
            Not shown here, and left as they are: {offGrid.map(([, a]) => assignmentName(a)).join(", ")}. The class or subject has changed since. Remove them from the list on the teacher's page.
          </p>
        )}

        {error && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {changed ? `${toAdd.length} to add, ${toRemove.length} to remove` : "No changes yet"}
          </span>
          <Button type="button" variant="outline" onClick={() => void close()}>Cancel</Button>
          <Button type="button" disabled={!changed || !termId || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
