import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Group } from "@/components/lead/group";
import { PlanningField as Field } from "@/components/mobilization/planning-form";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Type } from "@/constants/theme";
import { useLookups, useMe, useRepo } from "@/data/hooks";
import { useTheme } from "@/hooks/use-theme";
import {
  PLAYBOOK_INPUTS,
  PlaybookContentSchema,
  type ManagedPlaybook,
  type PlaybookContent,
} from "@/lib/mobilization-contracts";
import { TEAM_SLUGS } from "@/lib/schema";
import { goBack } from "@/lib/navigation";

const INPUT_NAMES: Record<string, string> = {
  "weather.temperatureC": "Temperature",
  "weather.trendCPerHour": "Temperature trend",
  "weather.condition": "Weather condition",
  "weather.warning": "Weather warning",
  upcomingSets: "Upcoming sets",
  crowdByZone: "Crowd observations",
  recentIncidents: "Recent incidents",
  roster: "Available crew",
  venue: "Venue layout",
  existingResponses: "Existing responses",
};
const key = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const newAction = (): PlaybookContent["actions"][number] => ({
  id: key("action"),
  requirement: "must",
  teamSlug: "first-aid",
  title: "",
  instructions: "",
  peopleNeeded: null,
  staffingGuidance: "",
  requiredSkills: [],
  locationGuidance: "",
  completionCriteria: "",
});
const newContent = (): PlaybookContent => ({
  schemaVersion: 1,
  slug: "",
  title: "",
  appliesWhen: "",
  requiredInputs: [],
  decisionPoints: [],
  constraints: [],
  actions: [newAction()],
  source: "",
});

export default function PlaybookScreen() {
  const { id, version } = useLocalSearchParams<{ id: string; version?: string }>();
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const { teams } = useLookups();
  const [managed, setManaged] = useState<ManagedPlaybook | null>(null);
  const [content, setContent] = useState<PlaybookContent>(newContent);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(id !== "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skills, setSkills] = useState<{ slug: string; name: string }[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsAttempt, setSkillsAttempt] = useState(0);
  const [crewInputs, setCrewInputs] = useState<Record<string, string>>({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const editable = me?.role === "coordinator" && (!managed || managed.status === "draft");
  const dirty =
    savedContent !== JSON.stringify(content) ||
    content.actions.some(
      (action) =>
        (crewInputs[action.id] ?? action.peopleNeeded?.toString() ?? "") !==
        (action.peopleNeeded?.toString() ?? ""),
    );
  const unknownSkills = skills
    ? [
        ...new Set(
          content.actions
            .flatMap((action) => action.requiredSkills)
            .filter((slug) => !skills.some((skill) => skill.slug === slug)),
        ),
      ]
    : [];

  useEffect(() => {
    let live = true;
    if (id === "new" || !repo.playbooks || me?.role !== "coordinator") return;
    void repo.playbooks
      .list()
      .then((rows) => {
        if (!live) return;
        const row =
          rows.find((playbook) => playbook.id === id) ??
          rows
            .filter(
              (playbook) =>
                playbook.content.slug === id && (!version || playbook.version === Number(version)),
            )
            .sort(
              (a, b) =>
                (a.status === "published" ? -1 : 0) - (b.status === "published" ? -1 : 0) ||
                b.version - a.version,
            )[0];
        if (!row) {
          setError("This playbook is no longer available.");
          return;
        }
        setManaged(row);
        setContent(row.content);
        setSavedContent(JSON.stringify(row.content));
        setCrewInputs(
          Object.fromEntries(
            row.content.actions.map((action) => [action.id, action.peopleNeeded?.toString() ?? ""]),
          ),
        );
      })
      .catch((cause) => {
        if (live)
          setError(cause instanceof Error ? cause.message : "Could not load this playbook.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, version, repo, me?.role, loadAttempt]);

  useEffect(() => {
    let live = true;
    if (!repo.mobilizations || me?.role !== "coordinator") return;
    void repo.mobilizations
      .context()
      .then((context) => {
        if (live) setSkills(context.skills);
      })
      .catch((cause) => {
        if (live)
          setSkillsError(
            cause instanceof Error ? cause.message : "Could not load the event’s skills.",
          );
      });
    return () => {
      live = false;
    };
  }, [repo, me?.role, skillsAttempt]);

  const update = <K extends keyof PlaybookContent>(field: K, value: PlaybookContent[K]) => {
    setContent((previous) => ({ ...previous, [field]: value }));
    setNotice(null);
    setError(null);
  };
  const updateAction = <K extends keyof PlaybookContent["actions"][number]>(
    actionId: string,
    field: K,
    value: PlaybookContent["actions"][number][K],
  ) =>
    update(
      "actions",
      content.actions.map((action) =>
        action.id === actionId ? { ...action, [field]: value } : action,
      ),
    );
  const remember = (row: ManagedPlaybook) => {
    setManaged(row);
    setContent(row.content);
    setSavedContent(JSON.stringify(row.content));
    setCrewInputs(
      Object.fromEntries(
        row.content.actions.map((action) => [action.id, action.peopleNeeded?.toString() ?? ""]),
      ),
    );
    setConfirmDelete(false);
    if (id !== row.id) router.setParams({ id: row.id, version: undefined });
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this playbook.");
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    void run(async () => {
      if (!skills && content.actions.some((action) => action.requiredSkills.length))
        throw new Error("Load the event’s skills before saving required certifications.");
      if (unknownSkills.length)
        throw new Error(`Remove unregistered skills before saving: ${unknownSkills.join(", ")}.`);
      const parsed = PlaybookContentSchema.safeParse({
        ...content,
        actions: content.actions.map((action) => ({
          ...action,
          peopleNeeded:
            crewInputs[action.id] === undefined
              ? action.peopleNeeded
              : crewInputs[action.id].trim()
                ? Number(crewInputs[action.id])
                : null,
        })),
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((issue) => `${issue.path.join(" ")}: ${issue.message}`)
            .join("\n"),
        );
      const row = await repo.playbooks!.saveDraft({
        id: managed?.id ?? null,
        expectedUpdatedAt: managed?.updatedAt ?? null,
        content: parsed.data,
      });
      remember(row);
      setNotice("Draft saved. Publish it when the rules are ready.");
    });

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title={managed ? "Playbook" : "New playbook"} back backFallback="/playbooks" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
      >
        {me?.role !== "coordinator" ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Mo manages the event’s response rules.
          </Text>
        ) : loading ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>Loading playbook…</Text>
        ) : id !== "new" && !managed ? (
          <>
            <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
              {error ?? "This playbook could not be loaded."}
            </Text>
            <Button
              label="Try again"
              variant="tinted"
              size="large"
              onPress={() => {
                setLoading(true);
                setError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            />
          </>
        ) : (
          <>
            {managed && (
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                {managed.status === "published"
                  ? "Published"
                  : managed.status === "disabled"
                    ? "Disabled"
                    : "Draft"}{" "}
                · Version {managed.version}
              </Text>
            )}
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              {editable
                ? "Describe your response rules. Each action needs an owner team and clear instructions. Leave optional fields blank when the source does not specify them."
                : "This version is preserved. Create a revision to change its rules."}
            </Text>
            <Field
              label="Title"
              value={content.title}
              onChange={(value) => update("title", value)}
              disabled={!editable || busy}
            />
            <Field
              label="Slug"
              autoCapitalize="none"
              value={content.slug}
              onChange={(value) => update("slug", value)}
              disabled={!editable || busy}
              hint="A stable name, such as heat-response. Use lowercase letters, numbers and hyphens."
            />
            <Field
              label="Applies when"
              value={content.appliesWhen}
              onChange={(value) => update("appliesWhen", value)}
              multiline
              disabled={!editable || busy}
            />

            <Group title="Inputs needed">
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Select the observations needed to judge these rules.
              </Text>
              <View style={styles.choices}>
                {[...new Set([...PLAYBOOK_INPUTS, ...content.requiredInputs])].map((input) => {
                  const selected = content.requiredInputs.includes(input);
                  return (
                    <Pressable
                      key={input}
                      accessibilityRole="checkbox"
                      accessibilityLabel={input}
                      accessibilityState={{ checked: selected, disabled: !editable || busy }}
                      aria-checked={selected}
                      disabled={!editable || busy}
                      onPress={() =>
                        update(
                          "requiredInputs",
                          selected
                            ? content.requiredInputs.filter((value) => value !== input)
                            : [...content.requiredInputs, input],
                        )
                      }
                      style={[
                        styles.choice,
                        {
                          borderColor: selected ? theme.tint : theme.border,
                          backgroundColor: selected ? theme.backgroundSelected : theme.background,
                        },
                      ]}
                    >
                      <Text style={[styles.body, { color: selected ? theme.tint : theme.text }]}>
                        {INPUT_NAMES[input] ?? input}
                        {selected ? " ✓" : ""}
                      </Text>
                      {INPUT_NAMES[input] && (
                        <Text style={[styles.small, { color: theme.textSecondary }]}>{input}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {editable && (
                <>
                  <Field
                    label="Custom input key"
                    value={customInput}
                    autoCapitalize="none"
                    disabled={busy}
                    hint="Keep the exact field name from your SOP, such as weather.windSpeed."
                    onChange={setCustomInput}
                  />
                  <Button
                    label="Add input key"
                    sf="plus"
                    variant="tinted"
                    size="large"
                    disabled={
                      busy ||
                      !customInput.trim() ||
                      content.requiredInputs.includes(customInput.trim()) ||
                      content.requiredInputs.length >= 40
                    }
                    onPress={() => {
                      const input = customInput.trim();
                      if (input.length > 120) {
                        setError("Input keys must be 120 characters or fewer.");
                        return;
                      }
                      update("requiredInputs", [...content.requiredInputs, input]);
                      setCustomInput("");
                    }}
                  />
                </>
              )}
            </Group>

            <Group title="Mo decision points" count={content.decisionPoints.length}>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Questions that Mo must decide before or during a response.
              </Text>
              {content.decisionPoints.map((decision, index) => (
                <View key={decision.id} style={styles.field}>
                  <Field
                    label={`Decision ${index + 1}: Mo decides`}
                    value={decision.question}
                    multiline
                    disabled={!editable || busy}
                    onChange={(value) =>
                      update(
                        "decisionPoints",
                        content.decisionPoints.map((item) =>
                          item.id === decision.id ? { ...item, question: value } : item,
                        ),
                      )
                    }
                  />
                  {editable && (
                    <Button
                      label="Remove decision point"
                      variant="plain"
                      size="large"
                      color={theme.danger}
                      disabled={busy}
                      onPress={() =>
                        update(
                          "decisionPoints",
                          content.decisionPoints.filter((item) => item.id !== decision.id),
                        )
                      }
                    />
                  )}
                </View>
              ))}
              {editable && (
                <Button
                  label="Add decision point"
                  sf="plus"
                  variant="tinted"
                  size="large"
                  disabled={busy || content.decisionPoints.length >= 20}
                  onPress={() =>
                    update("decisionPoints", [
                      ...content.decisionPoints,
                      { id: key("decision"), owner: "mo", question: "" },
                    ])
                  }
                />
              )}
            </Group>

            <Group title="Constraints" count={content.constraints.length}>
              {content.constraints.length === 0 && (
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  Add rules that every response must respect.
                </Text>
              )}
              {content.constraints.map((constraint, index) => (
                <View key={constraint.id} style={styles.field}>
                  <Field
                    label={`Constraint ${index + 1}`}
                    value={constraint.instruction}
                    multiline
                    disabled={!editable || busy}
                    onChange={(value) =>
                      update(
                        "constraints",
                        content.constraints.map((item) =>
                          item.id === constraint.id ? { ...item, instruction: value } : item,
                        ),
                      )
                    }
                  />
                  {editable && (
                    <Button
                      label="Remove constraint"
                      variant="plain"
                      color={theme.danger}
                      size="large"
                      disabled={busy}
                      onPress={() =>
                        update(
                          "constraints",
                          content.constraints.filter((item) => item.id !== constraint.id),
                        )
                      }
                    />
                  )}
                </View>
              ))}
              {editable && (
                <Button
                  label="Add constraint"
                  sf="plus"
                  variant="tinted"
                  size="large"
                  disabled={busy || content.constraints.length >= 20}
                  onPress={() =>
                    update("constraints", [
                      ...content.constraints,
                      { id: key("rule"), instruction: "" },
                    ])
                  }
                />
              )}
            </Group>

            <Group title="Response actions" count={content.actions.length}>
              {content.actions.map((action, index) => (
                <Card key={action.id} style={styles.action}>
                  <Text style={[styles.actionTitle, { color: theme.text }]}>
                    Action {index + 1}
                  </Text>
                  <Field
                    label={`Action ${index + 1} title`}
                    value={action.title}
                    disabled={!editable || busy}
                    onChange={(value) => updateAction(action.id, "title", value)}
                  />
                  <View style={styles.choices}>
                    {(["must", "recommended"] as const).map((requirement) => (
                      <Pressable
                        key={requirement}
                        accessibilityRole="radio"
                        accessibilityLabel={
                          requirement === "must" ? "Required action" : "Recommended action"
                        }
                        accessibilityState={{
                          checked: action.requirement === requirement,
                          disabled: !editable || busy,
                        }}
                        aria-checked={action.requirement === requirement}
                        disabled={!editable || busy}
                        onPress={() => updateAction(action.id, "requirement", requirement)}
                        style={[
                          styles.choice,
                          {
                            borderColor:
                              action.requirement === requirement ? theme.tint : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.body,
                            { color: action.requirement === requirement ? theme.tint : theme.text },
                          ]}
                        >
                          {requirement === "must" ? "Required" : "Recommended"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[styles.label, { color: theme.text }]}>Owner team</Text>
                  <View style={styles.choices}>
                    {TEAM_SLUGS.map((slug) => (
                      <Pressable
                        key={slug}
                        accessibilityRole="radio"
                        accessibilityLabel={teams[slug]?.name ?? slug}
                        accessibilityState={{
                          checked: action.teamSlug === slug,
                          disabled: !editable || busy,
                        }}
                        aria-checked={action.teamSlug === slug}
                        disabled={!editable || busy}
                        onPress={() => updateAction(action.id, "teamSlug", slug)}
                        style={[
                          styles.choice,
                          { borderColor: action.teamSlug === slug ? theme.tint : theme.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.body,
                            { color: action.teamSlug === slug ? theme.tint : theme.text },
                          ]}
                        >
                          {teams[slug]?.name ?? slug}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Field
                    label="Instructions"
                    value={action.instructions}
                    multiline
                    disabled={!editable || busy}
                    onChange={(value) => updateAction(action.id, "instructions", value)}
                  />
                  <Field
                    label="Crew required"
                    value={crewInputs[action.id] ?? action.peopleNeeded?.toString() ?? ""}
                    numeric
                    disabled={!editable || busy}
                    hint="Leave blank when staffing depends on the observations."
                    onChange={(value) => {
                      setCrewInputs((previous) => ({ ...previous, [action.id]: value }));
                      setNotice(null);
                      setError(null);
                    }}
                  />
                  <Field
                    label="Staffing guidance"
                    value={action.staffingGuidance}
                    multiline
                    disabled={!editable || busy}
                    onChange={(value) => updateAction(action.id, "staffingGuidance", value)}
                  />
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.text }]}>Required skills</Text>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      Choose from the event’s registered skills. Leave all clear when no specific
                      certification is required.
                    </Text>
                    {skills === null && !skillsError && (
                      <Text style={[styles.small, { color: theme.textSecondary }]}>
                        Loading skills…
                      </Text>
                    )}
                    {skillsError && (
                      <>
                        <Text
                          accessibilityRole="alert"
                          style={[styles.small, { color: theme.danger }]}
                        >
                          {skillsError}
                        </Text>
                        <Button
                          label="Reload skills"
                          variant="tinted"
                          size="large"
                          disabled={busy}
                          onPress={() => {
                            setSkillsError(null);
                            setSkills(null);
                            setSkillsAttempt((attempt) => attempt + 1);
                          }}
                        />
                      </>
                    )}
                    <View style={styles.choices}>
                      {skills?.map((skill) => {
                        const selected = action.requiredSkills.includes(skill.slug);
                        return (
                          <Pressable
                            key={skill.slug}
                            accessibilityRole="checkbox"
                            accessibilityLabel={skill.name}
                            accessibilityState={{ checked: selected, disabled: !editable || busy }}
                            aria-checked={selected}
                            disabled={!editable || busy}
                            onPress={() =>
                              updateAction(
                                action.id,
                                "requiredSkills",
                                selected
                                  ? action.requiredSkills.filter((value) => value !== skill.slug)
                                  : [...action.requiredSkills, skill.slug],
                              )
                            }
                            style={[
                              styles.choice,
                              {
                                borderColor: selected ? theme.tint : theme.border,
                                backgroundColor: selected
                                  ? theme.backgroundSelected
                                  : theme.background,
                              },
                            ]}
                          >
                            <Text
                              style={[styles.body, { color: selected ? theme.tint : theme.text }]}
                            >
                              {skill.name}
                              {selected ? " ✓" : ""}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {action.requiredSkills
                      .filter((value) => !skills?.some((skill) => skill.slug === value))
                      .map((value) => (
                        <View key={value} style={styles.field}>
                          <Text
                            style={[
                              styles.small,
                              { color: skills ? theme.warning : theme.textSecondary },
                            ]}
                          >
                            {skills ? "Unregistered saved skill" : "Saved skill"}: {value}
                          </Text>
                          {editable && skills && (
                            <Button
                              label={`Remove ${value}`}
                              variant="plain"
                              size="large"
                              color={theme.danger}
                              disabled={busy}
                              onPress={() =>
                                updateAction(
                                  action.id,
                                  "requiredSkills",
                                  action.requiredSkills.filter((skill) => skill !== value),
                                )
                              }
                            />
                          )}
                        </View>
                      ))}
                  </View>
                  <Field
                    label="Location guidance"
                    value={action.locationGuidance}
                    multiline
                    disabled={!editable || busy}
                    onChange={(value) => updateAction(action.id, "locationGuidance", value)}
                  />
                  <Field
                    label="Complete when"
                    hint="Optional. Keep blank if the SOP does not define a completion condition."
                    value={action.completionCriteria}
                    multiline
                    disabled={!editable || busy}
                    onChange={(value) => updateAction(action.id, "completionCriteria", value)}
                  />
                  {editable && content.actions.length > 1 && (
                    <Button
                      label="Remove action"
                      variant="plain"
                      color={theme.danger}
                      size="large"
                      disabled={busy}
                      onPress={() =>
                        update(
                          "actions",
                          content.actions.filter((item) => item.id !== action.id),
                        )
                      }
                    />
                  )}
                </Card>
              ))}
              {editable && (
                <Button
                  label="Add action"
                  sf="plus"
                  variant="tinted"
                  size="large"
                  disabled={busy || content.actions.length >= 30}
                  onPress={() => update("actions", [...content.actions, newAction()])}
                />
              )}
            </Group>
            <Field
              label="Source or reference"
              value={content.source}
              multiline
              disabled={!editable || busy}
              onChange={(value) => update("source", value)}
            />
            {error && (
              <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
                {error}
              </Text>
            )}
            {notice && (
              <Text accessibilityRole="alert" style={[styles.body, { color: theme.success }]}>
                {notice}
              </Text>
            )}
            {editable && (
              <Button
                label={busy ? "Saving…" : "Save draft"}
                sf="square.and.arrow.down"
                size="large"
                disabled={busy || !repo.playbooks || (!dirty && !!managed)}
                onPress={save}
              />
            )}
            {managed?.status === "draft" && (
              <>
                <Button
                  label="Publish"
                  sf="checkmark"
                  variant="tinted"
                  size="large"
                  disabled={
                    busy ||
                    dirty ||
                    !repo.playbooks ||
                    unknownSkills.length > 0 ||
                    (!skills && content.actions.some((action) => action.requiredSkills.length > 0))
                  }
                  onPress={() =>
                    void run(async () => {
                      remember(await repo.playbooks!.publish(managed.id, managed.updatedAt));
                      setNotice("Published. This version is available to analysis.");
                    })
                  }
                />
                {dirty && (
                  <Text style={[styles.small, { color: theme.textSecondary }]}>
                    Save your changes before publishing.
                  </Text>
                )}
                <Button
                  label={confirmDelete ? "Confirm delete draft" : "Delete draft"}
                  variant="plain"
                  size="large"
                  color={theme.danger}
                  disabled={busy}
                  onPress={() =>
                    confirmDelete
                      ? void run(async () => {
                          await repo.playbooks!.deleteDraft(managed.id, managed.updatedAt);
                          goBack("/playbooks");
                        })
                      : setConfirmDelete(true)
                  }
                />
                {confirmDelete && (
                  <Button
                    label="Keep draft"
                    variant="plain"
                    size="large"
                    disabled={busy}
                    onPress={() => setConfirmDelete(false)}
                  />
                )}
              </>
            )}
            {managed && managed.status !== "draft" && (
              <Button
                label="Create revision"
                sf="pencil"
                size="large"
                disabled={busy || !repo.playbooks}
                onPress={() =>
                  void run(async () => {
                    remember(await repo.playbooks!.revise(managed.id));
                    setNotice(
                      "Revision created as a draft. The published version stays available until you publish this revision.",
                    );
                  })
                }
              />
            )}
            {managed?.status === "published" && (
              <Button
                label="Disable this version"
                variant="plain"
                size="large"
                color={theme.danger}
                disabled={busy || !repo.playbooks}
                onPress={() =>
                  void run(async () => {
                    remember(await repo.playbooks!.disable(managed.id, managed.updatedAt));
                    setNotice("Disabled. New analysis will no longer use this version.");
                  })
                }
              />
            )}
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
  field: { gap: 7 },
  label: { fontSize: Type.callout, fontWeight: "600" },
  body: { fontSize: Type.callout, lineHeight: 20 },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: "center",
  },
  action: { padding: 16, gap: 16 },
  actionTitle: { fontSize: Type.title, fontWeight: "600" },
});
