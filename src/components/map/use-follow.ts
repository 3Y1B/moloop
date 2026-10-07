import { useState } from 'react';

import { cameraFor, frameBox, type Camera, type VenueMapProps } from './map-model';

/**
 * Who moves the camera.
 *  - auto: the screen's own framing (the route, the markers, me), following every change
 *  - free: the person dragged or pinched the map; it stays where they put it
 *  - me: they asked to go back to where they are; it stays centred on them as they move
 */
type Mode = 'auto' | 'free' | 'me';

export function useFollow(props: VenueMapProps, size: { width: number; height: number } | null) {
  const [mode, setMode] = useState<Mode>('auto');
  // The camera props as they were when the person took over: unchanged props leave the map where they put it.
  const [held, setHeld] = useState<Camera | null>(null);

  const framed = size ? cameraFor(frameBox(props, size), size.width) : null;
  // Just me, in the part of the map nothing covers.
  const mine = size && props.me
    ? cameraFor(frameBox({ ...props, route: null, target: null, markers: [], people: [], fit: 'route' }, size), size.width)
    : null;
  const live = mode === 'me' ? (mine ?? framed) : framed;

  return {
    camera: mode === 'free' ? held : live,
    /** The person moved the map themselves. */
    onUserMove: () => {
      if (mode === 'free') return;
      setHeld(live);
      setMode('free');
    },
    /** Only while they've moved away, and there's somewhere to go back to. */
    canRecenter: mode === 'free' && !!mine,
    /**
     * Back to me, then follow me. `move` takes the camera there itself: the props alone may not change (when the
     * screen already frames just me), and then the map wouldn't move.
     */
    recenter: (move: (camera: Camera) => void) => {
      if (mine) move(mine);
      setMode('me');
    },
  };
}
