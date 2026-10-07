import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { clockTime, REPLY_SF } from '@/lib/format';
import type { TaskEvent } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const KIND_SF: Record<TaskEvent['kind'], string> = {
  created: 'square.and.pencil',
  assigned: 'person.crop.circle.badge.checkmark',
  queued: 'tray.full',
  reply: 'bubble.left.fill',
  nudged: 'bell.fill',
  lead_alerted: 'exclamationmark.triangle.fill',
  escalated: 'exclamationmark.bubble.fill',
  reassigned: 'arrow.triangle.2.circlepath',
  resolved: 'checkmark.circle.fill',
  note: 'note.text',
  responded: 'person.crop.circle.badge.exclamationmark',
  bumped: 'arrow.up.circle.fill',
  proposed: 'sparkles',
  helper_added: 'person.badge.plus',
};

/** Android (Material Symbols) fallbacks for the same events. */
const KIND_MD: Record<TaskEvent['kind'], string> = {
  created: 'edit_square',
  assigned: 'person_check',
  queued: 'inbox',
  reply: 'chat_bubble',
  nudged: 'notifications',
  lead_alerted: 'warning',
  escalated: 'priority_high',
  reassigned: 'sync_alt',
  resolved: 'check_circle',
  note: 'notes',
  responded: 'support_agent',
  bumped: 'arrow_circle_up',
  proposed: 'auto_awesome',
  helper_added: 'person_add',
};

/**
 * Append-only task history: what replaces radio replay. Escalation reads in order: asked for help (red),
 * passed up to Mo (orange), then the response (blue): backup sent, handed over, called.
 */
export function Timeline({ events }: { events: TaskEvent[] }) {
  const theme = useTheme();
  const colorFor = (e: TaskEvent) =>
    e.kind === 'resolved'
      ? theme.success
      : e.kind === 'lead_alerted' || e.kind === 'escalated'
        ? theme.danger
        : e.kind === 'nudged' || e.kind === 'bumped'
          ? theme.warning
          : e.kind === 'responded'
            ? theme.tint
            : e.actor.kind === 'human'
              ? theme.tint
              : theme.textTertiary;

  return (
    <View style={styles.list}>
      {events.map((e, i) => {
        const color = colorFor(e);
        const last = i === events.length - 1;
        return (
          <View key={e.id} style={styles.item}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: `${color}14` }]}>
                <Icon
                  sf={e.reply ? REPLY_SF[e.reply] : KIND_SF[e.kind]}
                  md={e.reply ? 'chat_bubble' : KIND_MD[e.kind]}
                  size={12}
                  color={color}
                  weight="medium"
                />
              </View>
              {!last && <View style={[styles.line, { backgroundColor: theme.separator }]} />}
            </View>
            <View style={styles.body}>
              <Text style={[styles.text, { color: theme.text }]}>{e.text}</Text>
              {e.note && <Text style={[styles.note, { color: theme.textSecondary }]}>“{e.note}”</Text>}
              <Text style={[styles.meta, { color: theme.textTertiary }]}>
                {clockTime(e.at)} · {e.actor.name ?? (e.actor.kind === 'system' ? 'System' : 'Agent')}
                {e.actor.kind === 'agent' ? ' (AI)' : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 14, paddingVertical: 12 },
  item: { flexDirection: 'row', gap: 10 },
  rail: { alignItems: 'center', width: 24 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  line: { width: StyleSheet.hairlineWidth * 2, flex: 1, marginVertical: 2 },
  body: { flex: 1, paddingBottom: 14, paddingTop: 3, gap: 1 },
  text: { fontSize: Type.callout, lineHeight: 19 },
  note: { fontSize: Type.callout - 1, lineHeight: 18, fontStyle: 'italic' },
  meta: { fontSize: Type.caption, fontVariant: ['tabular-nums'] },
});
