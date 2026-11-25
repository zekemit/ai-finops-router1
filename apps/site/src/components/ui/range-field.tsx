import type { CSSProperties } from "react";

interface Props {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value as shown, e.g. `95%`. */
  readonly display: string;
  readonly onChange: (value: number) => void;
}

export function RangeField({ id, label, hint, value, min, max, step, display, onChange }: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[15px] font-medium">
          {label}
        </label>
        <output htmlFor={id} className="mono text-[15px] text-cyan">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="rng mt-1"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {hint !== undefined && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}
