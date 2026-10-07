import { useState } from 'react';

import { haptic } from '@/components/ui/pressable';
import { NOT_CAUGHT, useFlashTimer } from '@/components/voice/flash';
import { useHoldToTalk } from '@/components/voice/use-hold-to-talk';
import { useRepo } from '@/data/hooks';
import type { VoiceResponse } from '@/data/repo';

export type VoicePhase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'hearing' }
  /** What was heard, while the AI reads it and acts. */
  | { kind: 'acting'; text: string }
  | { kind: 'flash'; ok: boolean; message: string }
  /** Nothing it could do: the words stay up until the next hold or tap. */
  | { kind: 'missed'; text: string };

/**
 * Hold on the Respond screen. Hold to record, the server transcribes it, the words show while the AI reads them as
 * one of the responses on the screen ("send Tom", "hand to medics") and does it straight away. A step that needs the
 * screen (the picker, 000) comes back to `onResult` to open; 000 is never done from here.
 */
export function useRespondVoice({ taskId, onResult }: { taskId: string | undefined; onResult: (r: VoiceResponse) => void }) {
  const repo = useRepo();
  const hold = useHoldToTalk();
  const [phase, setPhase] = useState<VoicePhase>({ kind: 'idle' });
  const flashTimer = useFlashTimer();

  const flash = (ok: boolean, message: string) => {
    setPhase({ kind: 'flash', ok, message });
    flashTimer.start(() => setPhase((p) => (p.kind === 'flash' ? { kind: 'idle' } : p)));
  };

  const start = () => {
    if (phase.kind === 'hearing' || phase.kind === 'acting') return;
    hold.start();
    setPhase({ kind: 'listening' });
  };

  const end = async () => {
    if (phase.kind !== 'listening') return;
    setPhase({ kind: 'hearing' });
    let text: string | undefined;
    try {
      text = (await hold.stop())?.text.trim();
    } catch (e) {
      console.warn('[voice] transcribe failed', e);
      return flash(false, 'Voice is down');
    }
    if (!text) return flash(false, NOT_CAUGHT);
    if (!taskId) return setPhase({ kind: 'idle' });
    setPhase({ kind: 'acting', text });
    try {
      const r = await repo.respondByVoice(taskId, text);
      if (r.done) {
        haptic('success');
        flash(true, r.confirmation);
      } else if (r.open) setPhase({ kind: 'idle' });
      else setPhase({ kind: 'missed', text });
      onResult(r);
    } catch {
      // Refused (someone else got there first) or the server is down.
      haptic('error');
      flash(false, 'Didn’t go through');
    }
  };

  return { phase, level: hold.level, start, end, dismiss: () => setPhase({ kind: 'idle' }) };
}
