import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { useCrew, useLookups, useNeedsMe, useRole, useSnapshot, useTeam } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import { EmptyCard, Group } from './group';
import { MEMBER_INSET, MemberRow } from './member-row';
import { NeedsRow } from './needs-row';
import { openTaskSheet } from './open-sheet';
import { OpenTaskRow } from './open-task-row';

/** Past the priority signal, in line with the row title. */
const ROW_INSET = 39;

/**
 * The lead's view in the sheet: what needs them first, then everyone's status, then what's still open.
 * Mo has no team of their own: theirs is the whole crew.
 */
export function TeamSheet() {
  const theme = useTheme();
  const { proposals } = useSnapshot();
  const needs = useNeedsMe();
  const everyone = useRole() === 'coordinator';
  const mine = useTeam();
  const crew = useCrew();
  const { teams } = useLookups();
  const { team } = mine;
  const { members, openTasks } = everyone ? crew : mine;
  const color = team?.color ?? theme.tint;
  const onDuty = members.filter((m) => m.volunteer.duty === 'on_duty').length;

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        {team && <Icon sf={team.sf} md={team.md} size={17} color={team.color} weight="medium" />}
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{everyone ? 'Crew' : team?.name ?? 'Team'}</Text>
        <Text style={[styles.meta, { color: theme.textTertiary }]}>{onDuty} on duty</Text>
      </View>

      <Group title="Needs you" count={needs.length}>
        {needs.length === 0 ? (
          <EmptyCard text="All clear" />
        ) : (
          <Card>
            {needs.map((n, i) => (
              <Fragment key={`${n.kind}-${n.task.id}`}>
                {i > 0 && <Separator inset={ROW_INSET} />}
                <NeedsRow item={n} />
              </Fragment>
            ))}
          </Card>
        )}
      </Group>

      <Group title="People" count={members.length}>
        {members.length === 0 ? (
          <EmptyCard text="No one else on the team" />
        ) : (
          <Card>
            {members.map((m, i) => (
              <Fragment key={m.volunteer.id}>
                {i > 0 && <Separator inset={MEMBER_INSET} />}
                <MemberRow member={m} color={(everyone && m.volunteer.teamSlug && teams[m.volunteer.teamSlug]?.color) || color} />
              </Fragment>
            ))}
          </Card>
        )}
      </Group>

      {openTasks.length > 0 && (
        <Group title="Open tasks" count={openTasks.length}>
          <Card>
            {openTasks.map((t, i) => (
              <Fragment key={t.id}>
                {i > 0 && <Separator inset={ROW_INSET} />}
                <OpenTaskRow task={t} onPress={() => openTaskSheet(t, proposals)} />
              </Fragment>
            ))}
          </Card>
        </Group>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  title: { flex: 1, fontSize: Type.hero, fontWeight: '700', letterSpacing: -0.4 },
  meta: { fontSize: Type.footnote, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
