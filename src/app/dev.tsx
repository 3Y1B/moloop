import { router } from 'expo-router';
import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, Section, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { useLookups, useRepo, useSnapshot } from '@/data/hooks';
import { POLICY } from '@/lib/lifecycle';
import { useTheme } from '@/hooks/use-theme';

const MIN = 60_000;
const ROLE_LABEL = { volunteer: 'Volunteer', team_lead: 'Team lead', coordinator: 'Coordinator' } as const;

/** Demo-only controls for the mock repo: inject tasks, move the clock, switch identity. */
export default function DevScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const { meId } = useSnapshot();
  const { volunteers, teams } = useLookups();
  const dev = repo.dev;
  if (!dev) return null;

  const offsetMin = Math.round(dev.clockOffsetMs() / MIN);
  const spawn = (p: 'P1' | 'P2' | 'P3') => {
    dev.spawnIncoming(p);
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.text }]}>Demo controls</Text>

      <Section title="Incoming task for me">
        <View style={styles.row}>
          <Button label="P1" variant="tinted" color={theme.danger} onPress={() => spawn('P1')} style={styles.flex} />
          <Button label="P2" variant="tinted" color={theme.warning} onPress={() => spawn('P2')} style={styles.flex} />
          <Button label="P3" variant="tinted" color={theme.textSecondary} onPress={() => spawn('P3')} style={styles.flex} />
        </View>
        <Text style={[styles.help, { color: theme.textTertiary }]}>
          If you’re free it’s assigned and read aloud. If you’re busy it’s queued with a short ping.
        </Text>
      </Section>

      <Section title="Clock" trailing={offsetMin ? `+${offsetMin} min` : 'real time'}>
        <View style={styles.row}>
          <Button label="+1 min" sf="forward.fill" variant="tinted" onPress={() => dev.advance(MIN)} style={styles.flex} />
          <Button label="+5 min" sf="forward.end.fill" variant="tinted" onPress={() => dev.advance(5 * MIN)} style={styles.flex} />
        </View>
        <Text style={[styles.help, { color: theme.textTertiary }]}>
          No ack in {POLICY.ackTimeoutMs / MIN} min or past ETA → nudge. Still silent {POLICY.nudgeGapMs / MIN} min later → lead alerted. P1 goes straight to the lead.
        </Text>
      </Section>

      <Section title="Be someone else">
        <Card>
          {Object.values(volunteers).map((v, i) => (
            <Fragment key={v.id}>
              {i > 0 && <Separator />}
              <Pressable onPress={() => dev.setMe(v.id)} style={({ pressed }) => [styles.person, pressed && { backgroundColor: theme.backgroundSelected }]}>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: theme.text }]}>{v.name}</Text>
                  <Text style={[styles.sub, { color: theme.textSecondary }]}>
                    {ROLE_LABEL[v.role]}{v.teamSlug ? ` · ${teams[v.teamSlug]?.name}` : ''}
                  </Text>
                </View>
                {v.id === meId && <Icon sf="checkmark" md="check" size={17} color={theme.tint} weight="semibold" />}
              </Pressable>
            </Fragment>
          ))}
        </Card>
      </Section>

      <Button label="Reset demo" sf="arrow.counterclockwise" variant="tinted" color={theme.danger} haptic="warning" onPress={() => { dev.reset(); router.back(); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 28, gap: 22, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  help: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
  person: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11 },
  name: { fontSize: 15, fontWeight: '500' },
  sub: { fontSize: 12, marginTop: 1 },
});
