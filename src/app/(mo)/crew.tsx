import { CrewList } from '@/components/mo/crew-list';
import { MoPage } from '@/components/mo/mo-page';
import { TeamPills } from '@/components/mo/team-pills';

/** Every team and its people, with the task each person is on. The pills pick a team for the list and the map. */
export default function CrewScreen() {
  return (
    <MoPage title="Crew" sticky={<TeamPills />}>
      <CrewList />
    </MoPage>
  );
}
