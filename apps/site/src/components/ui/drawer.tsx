"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, summary, [tabindex]:not([tabindex="-1"])';

/**
 * A modal side sheet. It traps focus, closes on Escape or a click outside, locks page scroll while open,
 * and hands focus back to whatever opened it. The page behind it is made inert by the shell.
 */
export function Drawer({ open, onClose, title, description, children }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => panel.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || panel.current === null) return;
    const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            aria-hidden
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            key="panel"
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="panel fixed inset-y-0 right-0 z-50 flex w-full flex-col outline-none sm:max-w-[620px] sm:rounded-l-3xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
              <div>
                <h2 id={titleId} className="text-2xl font-semibold tracking-tight">
                  {title}
                </h2>
                <p id={descriptionId} className="mt-1 max-w-md text-[15px] text-ink-2">
                  {description}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${title}`}
                className="glass -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-300 ease-[var(--spring)] hover:bg-white/10 active:scale-90"
              >
                <X aria-hidden className="size-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
