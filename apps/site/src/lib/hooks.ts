import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Seconds since mount, refreshed every `intervalMs`. Starts at 0 so the server and first client render agree. */
export function useElapsedSeconds(intervalMs: number): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => setSeconds((performance.now() - start) / 1000), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return seconds;
}

/** Whether the referenced element is on screen. Starts false; never throws where IntersectionObserver is missing. */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer available: treat the element as visible so nothing is stuck waiting. Deferred, so it is not a synchronous setState in the effect.
      const timer = window.setTimeout(() => setInView(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}
