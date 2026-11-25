"use client";

import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

/** Accessible tabs: roving tabindex, arrow keys, Home and End. */
export function Tabs({ tabs, label }: { tabs: readonly TabItem[]; label: string }) {
  const base = useId();
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1;
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0) return;
    event.preventDefault();
    const next = tabs[target];
    if (next === undefined) return;
    setActive(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-white/10 pb-px">
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${base}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`relative min-h-11 whitespace-nowrap px-3.5 text-sm font-medium transition-colors ${selected ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              {tab.label}
              {selected && <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-cyan" />}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={`${base}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${base}-tab-${tab.id}`} hidden={tab.id !== active} tabIndex={0} className="pt-6">
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
