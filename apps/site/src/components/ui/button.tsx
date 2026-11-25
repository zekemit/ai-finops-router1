import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "glass" | "ghost";
type Size = "md" | "sm";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-[transform,background-color,filter] duration-300 ease-[var(--spring)] active:scale-[0.97]";
const VARIANT: Record<Variant, string> = {
  primary: "bg-cyan text-[#04141a] hover:brightness-110",
  glass: "glass text-ink hover:bg-white/10",
  ghost: "text-ink-2 hover:text-ink",
};
const SIZE: Record<Size, string> = { md: "min-h-11 px-6 text-[15px]", sm: "min-h-10 px-4 text-sm" };

interface Common {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly children: ReactNode;
}

const classes = (variant: Variant, size: Size, extra: string | undefined): string => [BASE, VARIANT[variant], SIZE[size], extra].filter(Boolean).join(" ");

export function Button({ variant = "glass", size = "md", className, children, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={classes(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({ variant = "glass", size = "md", className, children, ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={classes(variant, size, className)} {...rest}>
      {children}
    </a>
  );
}
