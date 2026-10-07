import { useEffect, useRef, useState } from 'react';

import type { Point } from '@/data/venue';

/** Longest a glide takes: a phone that went quiet for a while still lands promptly. */
const MAX_MS = 1_200;
/** Further than this is a jump (a zone picked by hand, a fresh fix after a gap): no glide. */
const JUMP_M = 60;
/** About 30 a second: smooth on screen without re-rendering the marker every frame. */
const FRAME_MS = 33;

/**
 * Where to draw a moving point right now. A new target is reached over about the time since the last one, so
 * a dot updated every second walks continuously instead of hopping, and a fast stream (the joystick) stays tight.
 */
export function useGlide(target: Point): Point {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const lastChange = useRef(0);

  useEffect(() => {
    const start = from.current;
    const now = Date.now();
    const gap = lastChange.current ? now - lastChange.current : MAX_MS;
    lastChange.current = now;
    if (Math.hypot(target.x - start.x, target.y - start.y) > JUMP_M) {
      from.current = target;
      setShown(target);
      return;
    }
    const duration = Math.min(MAX_MS, Math.max(FRAME_MS, gap));
    let frame = 0;
    let last = 0;
    const step = (t: number) => {
      const k = Math.min(1, (Date.now() - now) / duration);
      const p = { x: start.x + (target.x - start.x) * k, y: start.y + (target.y - start.y) * k };
      from.current = p;
      if (k >= 1 || t - last >= FRAME_MS) {
        last = t;
        setShown(p);
      }
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y]); // eslint-disable-line react-hooks/exhaustive-deps

  return shown;
}
