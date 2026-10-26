import { useEffect, useState } from 'react';
import { isMachine } from '../model/catalog';
import type { PlacedObject } from '../model/types';
import { DEFAULT_DETAIL, MACHINE_DETAILS, setMachineDetail, type MachineDetail } from './machines3d';

/** Shown on the dev server (npm run dev) and the e2e build only: the live site always draws machines 'chunky'. */
export const DEV_TOOLS = import.meta.env.DEV || import.meta.env.MODE === 'e2e';

const KEY = 'dev:machineDetail';

function stored(): MachineDetail {
  try {
    const v = localStorage.getItem(KEY);
    return MACHINE_DETAILS.some((d) => d.id === v) ? (v as MachineDetail) : DEFAULT_DETAIL;
  } catch {
    return DEFAULT_DETAIL;
  }
}

/**
 * A picker on the 3D view for how detailed the Mastrox machines are drawn, to compare the levels on a real layout.
 * Kept in this browser; rebuilds only the machines in view (`refresh` gets their catalog ids).
 */
export function DevMachineDetail({ objects, refresh }: { objects: PlacedObject[]; refresh: (assetIds: Set<string>) => void }) {
  const [value, setValue] = useState<MachineDetail>(() => (DEV_TOOLS ? stored() : DEFAULT_DETAIL));

  useEffect(() => {
    if (!DEV_TOOLS) return;
    if (setMachineDetail(value)) refresh(new Set(objects.filter(isMachine).map((o) => o.assetId)));
    // Only a change of level rebuilds; new machines placed later are made at the level already set.
  }, [value]);

  if (!DEV_TOOLS) return null;
  return (
    <label className="dev-detail" title="เฉพาะตอนพัฒนา (npm run dev): เว็บจริงใช้ก้อนใหญ่เสมอ">
      <span>DEV · เครื่องจักร</span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value as MachineDetail;
          try {
            localStorage.setItem(KEY, v);
          } catch {
            // Storage blocked: the choice lasts until the page closes.
          }
          setValue(v);
        }}
        data-testid="dev-machine-detail"
      >
        {MACHINE_DETAILS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}
