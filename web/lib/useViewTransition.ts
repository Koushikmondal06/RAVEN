'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from './Dashboard';

type Phase = 'idle' | 'exiting' | 'entering';

const EXIT_MS = 320;
const ENTER_MS = 420;

/**
 * Manages a two-phase page transition when the active view changes:
 *
 *   idle → exiting (EXIT_MS) → entering (ENTER_MS) → idle
 *
 * The hook returns:
 *  - `displayView`: the view that should actually be *rendered* (lags behind `requestedView`
 *    until the exit animation completes).
 *  - `phase`: which animation class to apply to the content wrapper.
 *  - `requestView(v)`: call this instead of a raw `setView` — it kicks off the exit, swaps the
 *    content at the midpoint, then plays the entrance.
 */
export function useViewTransition(initial: View) {
  const [displayView, setDisplayView] = useState<View>(initial);
  const [phase, setPhase] = useState<Phase>('idle');
  const pendingRef = useRef<View | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestView = useCallback(
    (next: View) => {
      // Same view or mid-transition — ignore.
      if (next === displayView && phase === 'idle') return;
      if (phase !== 'idle') return;

      pendingRef.current = next;
      setPhase('exiting');

      timerRef.current = setTimeout(() => {
        // Swap content at the midpoint — screen is visually "gone".
        setDisplayView(next);
        setPhase('entering');

        timerRef.current = setTimeout(() => {
          setPhase('idle');
          pendingRef.current = null;
          timerRef.current = null;
        }, ENTER_MS);
      }, EXIT_MS);
    },
    [displayView, phase],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { displayView, phase, requestView } as const;
}

export { EXIT_MS, ENTER_MS };
