import { useRef } from 'react';

/** How long a voice notice ("Didn't catch that", "Sent") stays up before getting out of the way. */
export const FLASH_MS = 2500;

/** A hold that heard nothing: a tap, silence, or no microphone. */
export const NOT_CAUGHT = 'Didn’t catch that';
/** Sending failed; the words are kept to try again. */
export const NOT_SENT = 'Didn’t send';

/**
 * Times a flash: `start(expire)` runs `expire` after FLASH_MS unless another flash started (or `cancel` ran) since.
 */
export function useFlashTimer() {
  const at = useRef(0);
  return {
    start(expire: () => void) {
      const stamp = (at.current = Date.now());
      setTimeout(() => {
        if (at.current === stamp) expire();
      }, FLASH_MS);
    },
    cancel() {
      at.current = 0;
    },
  };
}
