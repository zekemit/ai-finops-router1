import type { ReactNode } from "react";

export function SectionHeader({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <header className="max-w-2xl">
      <h2 id={id} className="text-balance text-[clamp(1.875rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
        {title}
      </h2>
      <p className="mt-4 text-pretty text-lg leading-relaxed text-ink-2">{children}</p>
    </header>
  );
}
