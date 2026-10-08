import { VoiceDock } from '@/components/voice/voice-dock';
import { useMyWork, useRepo } from '@/data/hooks';

/** The volunteer's assistant: reply to the task by voice, or report something new. */
export function TaskDock({ onMap }: { onMap?: boolean }) {
  const repo = useRepo();
  const { active } = useMyWork();
  const placeholder = !active ? 'Report something' : active.status === 'assigned' ? 'Accept or decline' : 'Update your task';

  return (
    <VoiceDock
      placeholder={placeholder}
      onMap={onMap}
      // The AI works out what was meant (a reply to the task, or a new report) and does it. A report keeps its clips.
      onSend={async (text, clips) => (await repo.commit({ ...(await repo.interpret(text)), clips })).confirmation}
    />
  );
}
