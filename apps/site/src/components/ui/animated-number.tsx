"use client";

import { useMotionValueEvent, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useState } from "react";

interface Props {
  readonly value: number;
  readonly format: (value: number) => string;
  readonly className?: string;
}

/** A numeral that settles on its new value with spring physics. Shows the target straight away when the visitor prefers reduced motion. */
export function AnimatedNumber({ value, format, className }: Props) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 170, damping: 26, mass: 0.7 });
  const [shown, setShown] = useState(value);

  useMotionValueEvent(spring, "change", setShown);

  useEffect(() => {
    if (reduce === true) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return <span className={className}>{format(reduce === true ? value : shown)}</span>;
}
