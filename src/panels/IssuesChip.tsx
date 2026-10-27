import { useMemo, useState } from 'react';
import { checkClearance, issueText } from '../model/clearance';
import type { Id } from '../model/types';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

/** Every placed thing that cannot stand where it is, with why; recomputed only when the project changes. */
export function useTroubled() {
  const project = useProject((s) => s.project);
  return useMemo(() => {
    if (!project) return [];
    const issues = checkClearance(project);
    return project.objects.filter((o) => issues.has(o.id)).map((o) => ({ id: o.id as Id, name: o.name, why: issues.get(o.id)!.map(issueText), safety: issues.get(o.id)!.some((i) => i.kind === 'safety') }));
  }, [project]);
}

/**
 * A red chip over the view while anything cannot stand where it is: how many, and a tap lists them with the reason;
 * a tap on one goes to it. The customer sees it as soon as a machine is dragged onto another, a wall or an aisle.
 */
export function IssuesChip() {
  const troubled = useTroubled();
  const [open, setOpen] = useState(false);
  if (!troubled.length) return null;
  return (
    <div className="issues-chip-wrap" data-testid="issues-chip">
      {open && (
        <ul className="issues-pop glass" data-testid="issues-list">
          {troubled.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  useUi.getState().goTo({ kind: 'object', id: t.id });
                  setOpen(false);
                }}
              >
                <b>{t.name}</b>
                <span>{t.why.join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="issues-chip" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden>⚠</span> วางไม่ได้ {troubled.length} {troubled.length === 1 ? `· ${troubled[0].name}` : 'ชิ้น'}
      </button>
    </div>
  );
}
