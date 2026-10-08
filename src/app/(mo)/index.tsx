import { useLocalSearchParams } from 'expo-router';

import { MoPage } from '@/components/mo/mo-page';
import { NeedsList } from '@/components/mo/needs-list';

/** Everything waiting on Mo, most urgent first. Mo lands here. */
export default function NeedsActionScreen() {
  const { analysis } = useLocalSearchParams<{ analysis?: string }>();
  return (
    // A new situation starts at the top even when this tab was previously scrolled down.
    // Only this tab's content remounts; the shared map and analysis provider stay mounted.
    <MoPage key={analysis ?? 'needs-action'} title="Needs action">
      <NeedsList analysisId={analysis} />
    </MoPage>
  );
}
