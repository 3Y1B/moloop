import { router, useFocusEffect } from "expo-router";
import { Fragment, useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Group } from "@/components/lead/group";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Card, Separator } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Type } from "@/constants/theme";
import { useMe, useRepo } from "@/data/hooks";
import { useTheme } from "@/hooks/use-theme";
import type { ManagedPlaybook } from "@/lib/mobilization-contracts";

const GROUPS = [
  {
    status: "published",
    title: "Published",
    empty: "No published playbooks. Save a draft and publish it to use it in analysis.",
  },
  { status: "draft", title: "Drafts", empty: "No drafts." },
  { status: "disabled", title: "Disabled", empty: "No disabled playbooks." },
] as const;

export default function PlaybooksScreen() {
  const theme = useTheme();
  const me = useMe();
  const repo = useRepo();
  const [playbooks, setPlaybooks] = useState<ManagedPlaybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!repo.playbooks || me?.role !== "coordinator") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPlaybooks(await repo.playbooks.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load playbooks.");
    } finally {
      setLoading(false);
    }
  }, [repo, me?.role]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Playbooks" back />
      <ScrollView contentContainerStyle={styles.content}>
        {me?.role !== "coordinator" ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Mo manages the event’s response rules.
          </Text>
        ) : (
          <>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Published playbooks define when to respond, which actions are required, and what
              counts as complete.
            </Text>
            <Button
              label="New playbook"
              sf="plus"
              size="large"
              disabled={!repo.playbooks}
              onPress={() => router.push({ pathname: "/playbooks/[id]", params: { id: "new" } })}
            />
            {loading && (
              <Text style={[styles.body, { color: theme.textSecondary }]}>Loading playbooks…</Text>
            )}
            {error && (
              <>
                <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
                  {error}
                </Text>
                <Button
                  label="Try again"
                  variant="tinted"
                  size="large"
                  onPress={() => void load()}
                />
              </>
            )}
            {!loading &&
              !error &&
              GROUPS.map((group) => {
                const rows = playbooks
                  .filter((playbook) => playbook.status === group.status)
                  .sort(
                    (a, b) =>
                      a.content.title.localeCompare(b.content.title) || b.version - a.version,
                  );
                return (
                  <Group key={group.status} title={group.title} count={rows.length}>
                    {rows.length === 0 ? (
                      <Text style={[styles.empty, { color: theme.textSecondary }]}>
                        {group.empty}
                      </Text>
                    ) : (
                      <Card>
                        {rows.map((playbook, index) => (
                          <Fragment key={playbook.id}>
                            {index > 0 && <Separator />}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`${playbook.content.title}, version ${playbook.version}, ${playbook.status}`}
                              onPress={() =>
                                router.push({
                                  pathname: "/playbooks/[id]",
                                  params: { id: playbook.id },
                                })
                              }
                              style={({ pressed }) => [
                                styles.row,
                                pressed && { backgroundColor: theme.backgroundSelected },
                              ]}
                            >
                              <View style={styles.flex}>
                                <Text style={[styles.title, { color: theme.text }]}>
                                  {playbook.content.title}
                                </Text>
                                <Text
                                  numberOfLines={2}
                                  style={[styles.body, { color: theme.textSecondary }]}
                                >
                                  {playbook.content.appliesWhen}
                                </Text>
                                <Text style={[styles.small, { color: theme.textSecondary }]}>
                                  Version {playbook.version} · {playbook.content.actions.length}{" "}
                                  actions
                                </Text>
                              </View>
                              <Icon
                                sf="chevron.right"
                                md="chevron_right"
                                size={12}
                                color={theme.textTertiary}
                              />
                            </Pressable>
                          </Fragment>
                        ))}
                      </Card>
                    )}
                  </Group>
                );
              })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 20,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, padding: 14 },
  flex: { flex: 1, gap: 4 },
  title: { fontSize: Type.body, fontWeight: "600" },
  body: { fontSize: Type.callout, lineHeight: 20 },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  empty: { fontSize: Type.callout, lineHeight: 20, paddingHorizontal: 4 },
});
