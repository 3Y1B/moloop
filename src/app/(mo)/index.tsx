import { MoPage } from '@/components/mo/mo-page';
import { NeedsList } from '@/components/mo/needs-list';

/** Everything waiting on Mo, most urgent first. Mo lands here. */
export default function NeedsActionScreen() {
  return (
    <MoPage title="Needs action">
      <NeedsList />
    </MoPage>
  );
}
