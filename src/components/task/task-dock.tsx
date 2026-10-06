import { VoiceDock } from '@/components/voice/voice-dock';
import { useMyWork, useRepo } from '@/data/hooks';

// Until audio + streaming STT land, a hold streams a plausible line for the current state.
// `{guess|final}` is a word the recogniser first mishears, then corrects.
const DEMO_LINE: Record<string, string> = {
  assigned: 'uh yeah got it, {hitting|heading} over now',
  accepted: 'ok he’s, um, he’s {salted|sorted} now. done',
  escalated: 'all done, {paramedic|paramedics} have taken over',
  none: 'there’s a spill near the uh track {state|stage} bar, it’s pretty {slippy|slippery}',
};
const DEMO_MORE = 'it’s right {buy|by} the bins near the {fans|fence}';

/** The volunteer's assistant: reply to the task by voice, or report something new. */
export function TaskDock() {
  const repo = useRepo();
  const { active } = useMyWork();
  const placeholder = !active ? 'Report something' : active.status === 'assigned' ? 'Accept or decline' : 'Update your task';

  return (
    <VoiceDock
      placeholder={placeholder}
      script={(before) => (before ? DEMO_MORE : DEMO_LINE[active?.status ?? 'none'] ?? DEMO_LINE.none)}
      // The AI works out what was meant (a reply to the task, or a new report) and does it.
      onSend={async (text) => (await repo.commit(await repo.interpret(text))).confirmation}
    />
  );
}
