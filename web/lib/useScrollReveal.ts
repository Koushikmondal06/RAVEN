'use client';

import { useEffect, useRef } from 'react';

/**
 * Intersection Observer hook that adds the `.revealed` class to an element when it scrolls
 * into view. Combined with the CSS `.reveal` base class this drives fade-up, stagger, and
 * glitch-in animations across the page — zero runtime cost once fired (the observer
 * disconnects after the first intersection).
 *
 * Usage:
 *   const ref = useScrollReveal<HTMLDivElement>();
 *   <div ref={ref} className="reveal"> … </div>
 *
 * Optional `delay` (ms) staggers siblings without needing a separate class per child.
 */
export function useScrollReveal<T extends HTMLElement>(delay = 0) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => el.classList.add('revealed'), delay);
          } else {
            el.classList.add('revealed');
          }
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return ref;
}

/**
 * Same as useScrollReveal but targets all direct children of the ref'd container, staggering
 * their `.revealed` class by `stagger` ms each. Useful for grids and lists where every item
 * should cascade in sequence.
 */
export function useScrollRevealChildren<T extends HTMLElement>(stagger = 80) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          Array.from(el.children).forEach((child, i) => {
            setTimeout(() => child.classList.add('revealed'), i * stagger);
          });
          observer.disconnect();
        }
      },
      { threshold: 0.08 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [stagger]);

  return ref;
}
