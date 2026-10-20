import { useEffect, useState, type ReactNode } from 'react';
import { parseClock, fmtClock } from '../model/project';
import { useProject } from '../store/project';

/** Edits made while a field has focus collapse into one undo step. */
export const gesture = {
  onFocus: () => useProject.getState().beginGesture(),
  onBlur: () => useProject.getState().endGesture(),
};

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  scale = 1,
  step = 1,
  min,
  suffix,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Displayed value = stored value / scale (e.g. 10 shows mm as cm). */
  scale?: number;
  step?: number;
  min?: number;
  suffix?: string;
  testId?: string;
}) {
  const shown = +(value / scale).toFixed(2);
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);
  const nudge = (dir: 1 | -1) => {
    const v = +(shown + dir * step).toFixed(2);
    if (min === undefined || v >= min) onChange(v * scale);
  };
  return (
    <Field label={label}>
      <div className="row">
        <div className="stepper">
          <input
            type="number"
            value={text}
            step={step}
            min={min}
            data-testid={testId}
            {...gesture}
            onChange={(e) => {
              setText(e.target.value);
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && (min === undefined || v >= min)) onChange(v * scale);
            }}
          />
          <button type="button" tabIndex={-1} aria-label={`ลด${label}`} onClick={() => nudge(-1)}>
            −
          </button>
          <button type="button" tabIndex={-1} aria-label={`เพิ่ม${label}`} onClick={() => nudge(1)}>
            +
          </button>
        </div>
        {suffix && <span className="muted">{suffix}</span>}
      </div>
    </Field>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input type="text" value={value} {...gesture} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  testId?: string;
}) {
  return (
    <Field label={label}>
      <div className="row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          data-testid={testId}
          onPointerDown={gesture.onFocus}
          onPointerUp={gesture.onBlur}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className="readout muted" style={{ minWidth: 48, textAlign: 'right' }}>
          {format(value)}
        </span>
      </div>
    </Field>
  );
}

/** A clock time (HH:MM) stored as minutes after midnight. */
export function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmtClock(value));
  useEffect(() => setText(fmtClock(value)), [value]);
  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="08:00"
        value={text}
        {...gesture}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseClock(e.target.value);
          if (v !== null) onChange(v);
        }}
        onBlur={(e) => {
          gesture.onBlur();
          if (parseClock(e.target.value) === null) setText(fmtClock(value));
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} data-testid={testId}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ColorField({ label, value, onChange, onReset }: { label: string; value: string; onChange: (v: string) => void; onReset?: () => void }) {
  return (
    <Field label={label}>
      <div className="row">
        <input type="color" value={value} {...gesture} onChange={(e) => onChange(e.target.value)} />
        {onReset && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
            ค่าเริ่มต้น
          </button>
        )}
      </div>
    </Field>
  );
}
