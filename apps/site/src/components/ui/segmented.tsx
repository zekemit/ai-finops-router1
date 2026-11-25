import type { KeyboardEvent } from "react";

interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface Props<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly Option<T>[];
  readonly onChange: (value: T) => void;
}

/** A radio group drawn as a segmented control, with roving focus and arrow-key selection. */
export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(from + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[(from + step + options.length) % options.length]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="glass inline-flex rounded-full p-1">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={`min-h-9 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-[background-color,color] duration-300 ${selected ? "bg-white text-canvas" : "text-ink-2 hover:text-ink"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
