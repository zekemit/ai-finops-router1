import type { ReactNode } from "react";

export function Pill({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-ink-2">
      {live && (
        <span aria-hidden className="relative flex size-2">
          <span className="beat absolute inline-flex size-full rounded-full bg-cyan" />
          <span className="relative inline-flex size-2 rounded-full bg-cyan" />
        </span>
      )}
      {children}
    </span>
  );
}
