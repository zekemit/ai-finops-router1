import { CopyButton } from "./copy-button";

interface Props {
  readonly code: string;
  /** What the block is, shown above it and used as its accessible name. */
  readonly title: string;
  /** Colour lines that start with + or - as additions and removals (the sign stays visible). */
  readonly diff?: boolean;
}

export function CodeBlock({ code, title, diff = false }: Props) {
  const lines = code.split("\n");
  return (
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-canvas/70">
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 pl-4 pr-1.5 text-[13px] text-ink-3">
        <span className="py-2">{title}</span>
        <CopyButton text={diff ? lines.map((l) => l.replace(/^[+-] ?/, "")).join("\n") : code} />
      </figcaption>
      <pre tabIndex={0} aria-label={title} className="mono overflow-x-auto p-4 text-[13px] leading-6">
        <code>
          {lines.map((line, index) => {
            const tone = diff ? (line.startsWith("+") ? "bg-emerald/10 text-emerald" : line.startsWith("-") ? "bg-critical/10 text-critical" : "text-ink-2") : "text-ink";
            return (
              <span key={index} className={`block whitespace-pre px-2 -mx-2 ${tone}`}>
                {line === "" ? " " : line}
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
