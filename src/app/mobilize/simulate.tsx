import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Group } from "@/components/lead/group";
import {
  ObservationEditor,
  buildObservationInputs,
  type ObservationDraft,
} from "@/components/mobilization/observation-editor";
import {
  PlanningChoice as Choice,
  PlanningField as Field,
} from "@/components/mobilization/planning-form";
import { ScreenHeader } from "@/components/screen-header";
import { PlanningSection } from "@/components/mobilization/planning-section";
import { AnalysisRow } from "@/components/mobilization/analysis-row";
import {
  describeEvidence,
  humanizeMissingInputs,
  readableText,
} from "@/components/mobilization/readable-analysis";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Type } from "@/constants/theme";
import { useMe, useRepo } from "@/data/hooks";
import { useMobilizationAnalyses } from "@/data/mobilization-analysis-provider";
import { useTheme } from "@/hooks/use-theme";
import {
  SimulationInputSchema,
  type SimulationContext,
  type SimulationInput,
  type SimulationRunResult,
} from "@/lib/mobilization-contracts";
import { IncidentCategory } from "@/lib/schema";
import { supportedInputKeys } from "@/lib/mobilization-inputs";
import { observationInputsToDrafts } from "@/lib/observation-drafts";
import { MOBILIZATION_SCENARIOS, buildScenario, type MobilizationScenarioId } from "@/lib/mobilization-scenarios";
import { isModelQuotaFailure } from "@/lib/model-failure";

type SetFact = {
  stageSlug: string;
  act: string;
  startsInMinutes: string;
  durationMinutes: string;
  expectedPeople: string;
};
type CrowdFact = {
  zoneSlug: string;
  estimatedPeople: string;
  trend: "stable" | "growing" | "falling" | "";
};
type IncidentFact = {
  category: SimulationInput["recentIncidents"][number]["category"];
  zoneSlug: string;
  minutesAgo: string;
  description: string;
  count: string;
  openCount: string;
};
const requestId = () =>
  `scenario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const number = (value: string, label: string) => {
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error(`Enter a number for ${label}.`);
  return Number(value);
};
const optionalNumber = (value: string, label: string) =>
  value.trim() ? number(value, label) : null;

/** Display only: keep the original failure in state for retry and quota handling. */
function analysisError(message: string | null | undefined, fallback: string): string {
  if (!message) return fallback;
  if (isModelQuotaFailure(message))
    return "Analysis credits or account limits need attention before you can retry.";
  if (/\b429\b|rate.?limit|too many requests/i.test(message))
    return "The analysis service is busy. Wait a moment, then retry.";
  if (/timed? out|timeout|deadline/i.test(message))
    return "The analysis took too long to finish. Retry when you are ready.";
  if (/configur|not ready|credential|unauthori[sz]ed|\b40[13]\b/i.test(message))
    return "The analysis connection needs attention. Check its setup, then refresh the connection.";
  if (/network|fetch|socket|connect|offline/i.test(message))
    return "Could not reach the event or analysis service. Check the connection and try again.";
  const numericField = message.match(/^Enter a number for (temperature(?: trend)?|warning start|set \d+ (?:start|duration|crowd)|crowd observation \d+|incident \d+ (?:time|count|open count))\.$/);
  if (numericField) return `Enter a number for ${numericField[1]}.`;
  if (/^Incident \d+: open reports cannot exceed the report count\.$/.test(message))
    return "Open incident reports cannot exceed the total report count.";
  if (message === "Choose a different stage for each upcoming set." || message === "Use one crowd observation per location.")
    return message;
  return fallback;
}

export default function SimulateMobilizationScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const params = useLocalSearchParams<{ analysis?: string }>();
  const { jobs, startAnalysis, retryAnalysis, dismissAnalysis } = useMobilizationAnalyses();
  const savedAnalysis = jobs.find((job) => job.id === params.analysis);
  const [followingAnalysis, setFollowingAnalysis] = useState(true);
  const hydratedAnalysis = useRef<string | null>(null);
  const [context, setContext] = useState<SimulationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localResult, setResult] = useState<SimulationRunResult | null>(null);
  const result = savedAnalysis && followingAnalysis ? savedAnalysis.result : localResult;
  const [temperature, setTemperature] = useState("28");
  const [trend, setTrend] = useState("");
  const [condition, setCondition] = useState<SimulationInput["weather"]["condition"]>("clear");
  const [warning, setWarning] = useState<SimulationInput["weather"]["warning"]>("none");
  const [warningInMinutes, setWarningInMinutes] = useState("");
  const [sets, setSets] = useState<SetFact[]>([]);
  const [crowds, setCrowds] = useState<CrowdFact[]>([]);
  const [incidents, setIncidents] = useState<IncidentFact[]>([]);
  const [observations, setObservations] = useState<ObservationDraft[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [refreshingContext, setRefreshingContext] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedScenario, setSelectedScenario] = useState<MobilizationScenarioId | null>(null);
  const [scenarioSummary, setScenarioSummary] = useState<string | null>(null);
  const [scenarioMissingContext, setScenarioMissingContext] = useState<string[]>([]);
  const [scenarioEdited, setScenarioEdited] = useState(false);
  const request = useRef({ signature: "", id: requestId() });
  const submitting = useRef(false);
  const permitted = me?.role === "coordinator";
  const quotaBlocked = result?.status === "failed" && isModelQuotaFailure(result.error);
  const lookups = {
    zones: result?.snapshot?.zones ?? context?.zones,
    teams: result?.snapshot?.teams ?? context?.teams,
    skills: result?.snapshot?.skills ?? context?.skills,
  };
  const missingObservations = humanizeMissingInputs([
    ...(result?.output?.assessment.missingInputs ?? []),
    ...(result?.output?.assessment.playbookAssessments
      .filter((review) => review.applicability === "insufficient_data")
      .flatMap((review) => review.missingInputs) ?? []),
  ], lookups);
  const changed = () => {
    setFollowingAnalysis(false);
    setResult(null);
    setError(null);
    setShowInput(false);
    setScenarioEdited(true);
  };
  const zones = context?.zones.map((zone) => ({ value: zone.slug, label: zone.name })) ?? [];
  const stages =
    context?.zones
      .filter(
        (zone) =>
          zone.kind === "stage" || context.timetable.some((set) => set.stageSlug === zone.slug),
      )
      .map((zone) => ({ value: zone.slug, label: zone.name })) ?? [];
  const zoneName = (slug: string | null) =>
    context?.zones.find((zone) => zone.slug === slug)?.name ?? (slug ? "Location not identified" : "Location not provided");
  const supportedInputs = new Set(supportedInputKeys());
  const unavailableInputs =
    context?.playbooks
      .filter((playbook) => playbook.status === "published")
      .map((playbook) => ({
        id: playbook.id,
        title: playbook.content.title,
        keys: playbook.content.requiredInputs.filter((input) => !supportedInputs.has(input)),
      }))
      .filter((playbook) => playbook.keys.length > 0) ?? [];

  useEffect(() => {
    let live = true;
    if (!permitted || !repo.mobilizations) return;
    void repo.mobilizations
      .context()
      .then((loaded) => {
        if (!live) return;
        setContext(loaded);
        const now = Date.now();
        setSets(
          loaded.timetable
            .filter((set) => Date.parse(set.endsAt) > now)
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
            .slice(0, 2)
            .map((set) => ({
              stageSlug: set.stageSlug,
              act: set.act,
              startsInMinutes: Math.max(
                0,
                Math.min(1440, Math.round((Date.parse(set.startsAt) - now) / 60_000)),
              ).toString(),
              durationMinutes: Math.max(
                1,
                Math.min(
                  360,
                  Math.round((Date.parse(set.endsAt) - Date.parse(set.startsAt)) / 60_000),
                ),
              ).toString(),
              expectedPeople: set.expectedPeople?.toString() ?? "",
            })),
        );
      })
      .catch((cause) => {
        if (live)
          setError(cause instanceof Error ? cause.message : "Could not load event context.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [repo, permitted, loadAttempt]);

  // Restore the exact test facts when a waiting/result row is opened from Team.
  useEffect(() => {
    if (!savedAnalysis || !context || loading || hydratedAnalysis.current === savedAnalysis.id) return;
    hydratedAnalysis.current = savedAnalysis.id;
    const facts = savedAnalysis.input;
    setTemperature(facts.weather.temperatureC == null ? "" : String(facts.weather.temperatureC));
    setTrend(facts.weather.trendCPerHour == null ? "" : String(facts.weather.trendCPerHour));
    setCondition(facts.weather.condition);
    setWarning(facts.weather.warning);
    setWarningInMinutes(facts.weather.warningInMinutes == null ? "" : String(facts.weather.warningInMinutes));
    setSets(facts.upcomingSets.map((set) => ({ ...set,
      startsInMinutes: String(set.startsInMinutes), durationMinutes: String(set.durationMinutes),
      expectedPeople: set.expectedPeople == null ? "" : String(set.expectedPeople),
    })));
    setCrowds(facts.crowdByZone.map((crowd) => ({ ...crowd,
      estimatedPeople: crowd.estimatedPeople == null ? "" : String(crowd.estimatedPeople), trend: crowd.trend ?? "",
    })));
    setIncidents(facts.recentIncidents.map((incident) => ({ ...incident,
      zoneSlug: incident.zoneSlug ?? "", minutesAgo: String(incident.minutesAgo),
      count: String(incident.count), openCount: String(incident.openCount),
    })));
    setObservations(observationInputsToDrafts(facts.observations ?? []));
    const selected = MOBILIZATION_SCENARIOS.find((scenario) => scenario.title === savedAnalysis.title);
    setSelectedScenario(selected?.id ?? null);
    setScenarioSummary(selected?.summary ?? "The observations from this situation test.");
    const { requestId: id, ...originalFacts } = facts;
    request.current = { signature: JSON.stringify(originalFacts), id };
    setFollowingAnalysis(true);
  }, [savedAnalysis, context, loading]);

  const openTeam = (id: string) => router.dismissTo({ pathname: "/(mo)", params: { analysis: id } });

  const evaluate = async (reserved = false) => {
    if ((!reserved && (busy || submitting.current)) || !repo.mobilizations) return;
    submitting.current = true;
    setError(null);
    setResult(null);
    setShowInput(false);
    try {
      const facts = {
        weather: {
          temperatureC: optionalNumber(temperature, "temperature"),
          trendCPerHour: optionalNumber(trend, "temperature trend"),
          condition,
          warning,
          warningInMinutes:
            !warning || warning === "none" ? null : optionalNumber(warningInMinutes, "warning start"),
        },
        upcomingSets: sets.map((set, index) => ({
          ...set,
          startsInMinutes: number(set.startsInMinutes, `set ${index + 1} start`),
          durationMinutes: number(set.durationMinutes, `set ${index + 1} duration`),
          expectedPeople: optionalNumber(set.expectedPeople, `set ${index + 1} crowd`),
        })),
        crowdByZone: crowds.map((crowd, index) => ({
          ...crowd,
          estimatedPeople: optionalNumber(crowd.estimatedPeople, `crowd observation ${index + 1}`),
          trend: crowd.trend || null,
        })),
        recentIncidents: incidents.map((incident, index) => ({
          ...incident,
          zoneSlug: incident.zoneSlug || null,
          minutesAgo: number(incident.minutesAgo, `incident ${index + 1} time`),
          count: number(incident.count, `incident ${index + 1} count`),
          openCount: number(incident.openCount, `incident ${index + 1} open count`),
        })),
        observations: buildObservationInputs(observations, context?.zones ?? []),
      };
      for (const [index, incident] of facts.recentIncidents.entries())
        if (incident.openCount > incident.count)
          throw new Error(`Incident ${index + 1}: open reports cannot exceed the report count.`);
      if (new Set(facts.upcomingSets.map((set) => set.stageSlug)).size !== facts.upcomingSets.length)
        throw new Error("Choose a different stage for each upcoming set.");
      if (new Set(facts.crowdByZone.map((crowd) => crowd.zoneSlug)).size !== facts.crowdByZone.length)
        throw new Error("Use one crowd observation per location.");
      const signature = JSON.stringify(facts);
      if (signature !== request.current.signature) request.current = { signature, id: requestId() };
      const parsed = SimulationInputSchema.safeParse({ requestId: request.current.id, ...facts });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((issue) => `${issue.path.join(" ")}: ${issue.message}`)
            .join("\n"),
        );
      setBusy(true);
      const title = MOBILIZATION_SCENARIOS.find((scenario) => scenario.id === selectedScenario)?.title
        ?? "Custom situation";
      const id = startAnalysis(parsed.data, scenarioEdited ? `${title} (customised)` : title);
      openTeam(id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not analyse this situation. Try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const applyScenario = (id: MobilizationScenarioId) => {
    if (!context || busy || refreshingContext || submitting.current) return;
    try {
      const scenario = buildScenario(id, context);
      const facts = SimulationInputSchema.parse({ requestId: requestId(), ...scenario.input });
      changed();
      setTemperature(facts.weather.temperatureC == null ? "" : String(facts.weather.temperatureC));
      setTrend(facts.weather.trendCPerHour == null ? "" : String(facts.weather.trendCPerHour));
      setCondition(facts.weather.condition);
      setWarning(facts.weather.warning);
      setWarningInMinutes(facts.weather.warningInMinutes == null ? "" : String(facts.weather.warningInMinutes));
      setSets(facts.upcomingSets.map((set) => ({
        ...set, startsInMinutes: String(set.startsInMinutes), durationMinutes: String(set.durationMinutes),
        expectedPeople: set.expectedPeople == null ? "" : String(set.expectedPeople),
      })));
      setCrowds(facts.crowdByZone.map((crowd) => ({
        ...crowd, estimatedPeople: crowd.estimatedPeople == null ? "" : String(crowd.estimatedPeople),
        trend: crowd.trend ?? "",
      })));
      setIncidents(facts.recentIncidents.map((incident) => ({
        ...incident, zoneSlug: incident.zoneSlug ?? "", minutesAgo: String(incident.minutesAgo),
        count: String(incident.count), openCount: String(incident.openCount),
      })));
      setObservations(observationInputsToDrafts(facts.observations));
      setSelectedScenario(id);
      setScenarioSummary(scenario.summary);
      setScenarioMissingContext(scenario.missingContext);
      setScenarioEdited(false);
      request.current = { signature: "", id: requestId() };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply this test situation.");
    }
  };

  const refreshContext = async () => {
    if (!repo.mobilizations || refreshingContext) return;
    setRefreshingContext(true);
    setError(null);
    try {
      setContext(await repo.mobilizations.context());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not refresh the analysis connection.",
      );
    } finally {
      setRefreshingContext(false);
    }
  };
  const deliberateAttempt = async () => {
    if (busy || refreshingContext || submitting.current || !repo.mobilizations) return;
    submitting.current = true;
    setRefreshingContext(true);
    setBusy(true);
    setError(null);
    try {
      const refreshed = await repo.mobilizations.context();
      setContext(refreshed);
      if (!refreshed.modelReady)
        throw new Error(refreshed.modelConfigurationMessage ?? "The analysis model is not ready.");
      if (savedAnalysis && followingAnalysis && savedAnalysis.status === "failed") {
        const id = retryAnalysis(savedAnalysis.id);
        if (id) openTeam(id);
        return;
      }
      if (savedAnalysis && followingAnalysis && savedAnalysis.status === "completed" && !savedAnalysis.result?.mobilizationIds.length)
        dismissAnalysis(savedAnalysis.id);
      request.current = { ...request.current, id: requestId() };
      await evaluate(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start a new analysis.");
    } finally {
      submitting.current = false;
      setRefreshingContext(false);
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Test situation" back backFallback="/(mo)" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
      >
        {!permitted ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Mo can test a situation and review the proposed response.
          </Text>
        ) : !repo.mobilizations ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Situation analysis is available when connected to the event server.
          </Text>
        ) : loading ? (
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Loading venue, timetable and playbooks…
          </Text>
        ) : !context ? (
          <>
            <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
              {analysisError(error, "The event information could not be loaded. Try again.")}
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
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Edit observations for this test. Analysis uses your published playbooks, venue and
              current crew. Proposed tasks are sent only after Mo approves.
            </Text>
            {context && !context.modelReady && (
              <>
                <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
                  The analysis connection is not ready. Check its setup, then refresh the connection.
                </Text>
                <Button
                  label={refreshingContext ? "Checking connection…" : "Refresh analysis connection"}
                  variant="tinted"
                  size="large"
                  disabled={busy || refreshingContext}
                  onPress={() => void refreshContext()}
                />
              </>
            )}
            {context && (
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                {context.zones.length} venue zones ·{" "}
                {context.playbooks.filter((playbook) => playbook.status === "published").length}{" "}
                published playbooks
              </Text>
            )}
            {unavailableInputs.length > 0 && (
              <Group title="SOP inputs not connected">
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  These requirements are preserved from your playbooks. This test cannot supply them
                  yet, so the analysis must state what is missing.
                </Text>
                {unavailableInputs.map((playbook) => (
                  <View key={playbook.id} style={styles.field}>
                    <Text style={[styles.label, { color: theme.text }]}>{playbook.title}</Text>
                    <Text style={[styles.small, { color: theme.warning }]}>
                      {humanizeMissingInputs(playbook.keys, lookups).join(", ")}
                    </Text>
                  </View>
                ))}
              </Group>
            )}

            <Group title="Quick situations" count={MOBILIZATION_SCENARIOS.length}>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Select a situation to replace the test observations, then open any setting to adjust it.
                This does not run AI or create a mobilization. Crew and playbooks still come from the database.
              </Text>
              <View style={styles.scenarioChoices}>
                {MOBILIZATION_SCENARIOS.map((scenario) => (
                  <Pressable
                    key={scenario.id}
                    accessibilityRole="button"
                    accessibilityLabel={scenario.title}
                    accessibilityState={{ selected: selectedScenario === scenario.id, disabled: busy || refreshingContext }}
                    aria-pressed={selectedScenario === scenario.id}
                    disabled={busy || refreshingContext}
                    onPress={() => applyScenario(scenario.id)}
                    style={({ pressed }) => [styles.scenarioChoice, {
                      borderColor: selectedScenario === scenario.id ? theme.tint : theme.border,
                      backgroundColor: selectedScenario === scenario.id ? theme.backgroundSelected : theme.card,
                      opacity: busy || refreshingContext ? 0.5 : pressed ? 0.7 : 1,
                    }]}
                  >
                    <Text style={[styles.label, { color: selectedScenario === scenario.id ? theme.tint : theme.text }]}>
                      {scenario.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {scenarioSummary && (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  {scenarioEdited ? "Customised situation: " : "Selected situation: "}{scenarioSummary}
                </Text>
              )}
              {scenarioMissingContext.length > 0 && (
                <Text style={[styles.small, { color: theme.warning }]}>
                  Not supplied: {scenarioMissingContext.join("; ")}
                </Text>
              )}
            </Group>

            <PlanningSection title="Weather" summary={`${temperature ? `${temperature}°C` : "Temperature not supplied"} · ${condition ?? "condition not supplied"} · warning: ${warning ?? "not supplied"}`} disabled={busy || refreshingContext}>
              <Field
                label="Temperature (°C)"
                value={temperature}
                numeric
                disabled={busy}
                hint="Leave blank if the temperature is unknown."
                onChange={(value) => {
                  changed();
                  setTemperature(value);
                }}
              />
              <Field
                label="Temperature trend (°C per hour)"
                value={trend}
                numeric
                disabled={busy}
                hint="Leave blank if unknown. A negative value means cooling."
                onChange={(value) => {
                  changed();
                  setTrend(value);
                }}
              />
              <Choice
                label="Condition"
                value={condition ?? ""}
                choices={[
                  { value: "", label: "Not supplied" },
                  { value: "clear", label: "Clear" },
                  { value: "rain", label: "Rain" },
                  { value: "storm", label: "Storm" },
                ]}
                disabled={busy}
                onChange={(value) => {
                  changed();
                  setCondition(value ? value as typeof condition : null);
                }}
              />
              <Choice
                label="Warning"
                value={warning ?? ""}
                choices={[
                  { value: "", label: "Not supplied" },
                  { value: "none", label: "None" },
                  { value: "heat", label: "Heat" },
                  { value: "storm", label: "Storm" },
                ]}
                disabled={busy}
                onChange={(value) => {
                  changed();
                  setWarning(value ? value as typeof warning : null);
                }}
              />
              {warning && warning !== "none" && (
                <Field
                  label="Warning starts in (minutes)"
                  value={warningInMinutes}
                  numeric
                  disabled={busy}
                  hint="0 means active now. Leave blank if the start time is unknown."
                  onChange={(value) => {
                    changed();
                    setWarningInMinutes(value);
                  }}
                />
              )}
            </PlanningSection>

            <PlanningSection title="Upcoming sets" summary={`${sets.length} sets · ${sets.map((set) => `${zoneName(set.stageSlug)} in ${set.startsInMinutes} min`).join(" · ") || "No upcoming sets supplied"}`} disabled={busy || refreshingContext}>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Initial times come from the saved event timetable. Change them to test a different
                moment.
              </Text>
              {sets.map((set, index) => {
                const update = (field: keyof SetFact, value: string) => {
                  changed();
                  setSets((previous) =>
                    previous.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [field]: value } : item,
                    ),
                  );
                };
                return (
                  <Card key={index} style={styles.factCard}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Set {index + 1}</Text>
                    <Choice
                      label="Stage"
                      value={set.stageSlug}
                      choices={stages}
                      disabled={busy}
                      onChange={(value) => update("stageSlug", value)}
                    />
                    <Field
                      label="Act"
                      value={set.act}
                      disabled={busy}
                      onChange={(value) => update("act", value)}
                    />
                    <Field
                      label="Starts in (minutes)"
                      value={set.startsInMinutes}
                      numeric
                      disabled={busy}
                      onChange={(value) => update("startsInMinutes", value)}
                    />
                    <Field
                      label="Duration (minutes)"
                      value={set.durationMinutes}
                      numeric
                      disabled={busy}
                      onChange={(value) => update("durationMinutes", value)}
                    />
                    <Field
                      label="Expected people"
                      value={set.expectedPeople}
                      numeric
                      disabled={busy}
                      hint="Leave blank if unknown."
                      onChange={(value) => update("expectedPeople", value)}
                    />
                    <Button
                      label="Remove set"
                      variant="plain"
                      size="large"
                      color={theme.danger}
                      disabled={busy}
                      onPress={() => {
                        changed();
                        setSets((previous) =>
                          previous.filter((_, itemIndex) => itemIndex !== index),
                        );
                      }}
                    />
                  </Card>
                );
              })}
              {sets.length < 2 && (
                <Button
                  label="Add set"
                  sf="plus"
                  variant="tinted"
                  size="large"
                  disabled={busy || stages.length === 0}
                  onPress={() => {
                    changed();
                    setSets((previous) => [
                      ...previous,
                      {
                        stageSlug: stages[0]?.value ?? "",
                        act: "",
                        startsInMinutes: "30",
                        durationMinutes: "60",
                        expectedPeople: "",
                      },
                    ]);
                  }}
                />
              )}
            </PlanningSection>

            <PlanningSection title="Crowd observations" summary={`${crowds.length} zone observations`} disabled={busy || refreshingContext}>
              {crowds.length === 0 && (
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  No crowd observations supplied. Add an estimate where the crowd is changing.
                </Text>
              )}
              {crowds.map((crowd, index) => {
                const update = (field: keyof CrowdFact, value: string) => {
                  changed();
                  setCrowds((previous) =>
                    previous.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [field]: value } : item,
                    ),
                  );
                };
                return (
                  <Card key={index} style={styles.factCard}>
                    <Choice
                      label={`Crowd ${index + 1} location`}
                      value={crowd.zoneSlug}
                      choices={zones}
                      disabled={busy}
                      onChange={(value) => update("zoneSlug", value)}
                    />
                    <Field
                      label="Estimated people"
                      value={crowd.estimatedPeople}
                      numeric
                      disabled={busy}
                      hint="Leave blank if unknown."
                      onChange={(value) => update("estimatedPeople", value)}
                    />
                    <Choice
                      label="Crowd trend"
                      value={crowd.trend}
                      choices={[
                        { value: "", label: "Unknown" },
                        { value: "stable", label: "Stable" },
                        { value: "growing", label: "Growing" },
                        { value: "falling", label: "Falling" },
                      ]}
                      disabled={busy}
                      onChange={(value) => update("trend", value)}
                    />
                    <Button
                      label="Remove crowd observation"
                      variant="plain"
                      size="large"
                      color={theme.danger}
                      disabled={busy}
                      onPress={() => {
                        changed();
                        setCrowds((previous) =>
                          previous.filter((_, itemIndex) => itemIndex !== index),
                        );
                      }}
                    />
                  </Card>
                );
              })}
              <Button
                label="Add crowd observation"
                sf="plus"
                variant="tinted"
                size="large"
                disabled={busy || crowds.length >= 30 || zones.length === 0}
                onPress={() => {
                  changed();
                  setCrowds((previous) => [
                    ...previous,
                    { zoneSlug: zones[0]?.value ?? "", estimatedPeople: "", trend: "" },
                  ]);
                }}
              />
            </PlanningSection>

            <PlanningSection title="Recent incidents" summary={`${incidents.length} incident facts · ${incidents.reduce((total, incident) => total + (Number(incident.count) || 0), 0)} reports`} disabled={busy || refreshingContext}>
              {incidents.length === 0 && (
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  No incident facts supplied. Add reports with a time, location and description.
                </Text>
              )}
              {incidents.map((incident, index) => {
                const update = (field: keyof IncidentFact, value: string) => {
                  changed();
                  setIncidents((previous) =>
                    previous.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [field]: value } : item,
                    ),
                  );
                };
                return (
                  <Card key={index} style={styles.factCard}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>
                      Incident fact {index + 1}
                    </Text>
                    <Choice
                      label="Category"
                      value={incident.category}
                      choices={IncidentCategory.options.map((category) => ({
                        value: category,
                        label: category.replaceAll("_", " "),
                      }))}
                      disabled={busy}
                      onChange={(value) => update("category", value)}
                    />
                    <Choice
                      label="Incident location"
                      value={incident.zoneSlug}
                      choices={[{ value: "", label: "Unknown" }, ...zones]}
                      disabled={busy}
                      onChange={(value) => update("zoneSlug", value)}
                    />
                    <Field
                      label="Minutes ago"
                      value={incident.minutesAgo}
                      numeric
                      disabled={busy}
                      onChange={(value) => update("minutesAgo", value)}
                    />
                    <Field
                      label="Description"
                      value={incident.description}
                      multiline
                      disabled={busy}
                      onChange={(value) => update("description", value)}
                    />
                    <Field
                      label="Report count"
                      value={incident.count}
                      numeric
                      disabled={busy}
                      onChange={(value) => update("count", value)}
                    />
                    <Field
                      label="Still open"
                      value={incident.openCount}
                      numeric
                      disabled={busy}
                      onChange={(value) => update("openCount", value)}
                    />
                    <Button
                      label="Remove incident fact"
                      variant="plain"
                      size="large"
                      color={theme.danger}
                      disabled={busy}
                      onPress={() => {
                        changed();
                        setIncidents((previous) =>
                          previous.filter((_, itemIndex) => itemIndex !== index),
                        );
                      }}
                    />
                  </Card>
                );
              })}
              <Button
                label="Add incident fact"
                sf="plus"
                variant="tinted"
                size="large"
                disabled={busy || incidents.length >= 30}
                onPress={() => {
                  changed();
                  setIncidents((previous) => [
                    ...previous,
                    {
                      category: "heat",
                      zoneSlug: "",
                      minutesAgo: "5",
                      description: "",
                      count: "1",
                      openCount: "1",
                    },
                  ]);
                }}
              />
            </PlanningSection>

            {context && (
              <PlanningSection title="Additional observations" summary={`${observations.length} hypothetical observations · unknown values stay unknown`} disabled={busy || refreshingContext}>
              <ObservationEditor
                context={context}
                value={observations}
                disabled={busy || refreshingContext}
                onChange={(next) => {
                  changed();
                  setObservations(next);
                }}
              />
              </PlanningSection>
            )}

            {error && (
              <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
                {analysisError(error, "Check the test settings or retry the analysis.")}
              </Text>
            )}
            <View style={styles.analysisAction}>
              <Button
                label={
                  busy
                    ? "Analysing situation…"
                    : savedAnalysis && followingAnalysis
                      ? "Back to Team"
                      : "Test situation"
                }
                sf="sparkles"
                size="large"
                style={styles.analysisButton}
                disabled={busy || refreshingContext || (!followingAnalysis || !savedAnalysis) && (quotaBlocked || !context?.modelReady || !repo.mobilizations)}
                onPress={() => savedAnalysis && followingAnalysis ? openTeam(savedAnalysis.id) : void evaluate()}
              />
              <Text style={[styles.small, styles.analysisEstimate, { color: theme.textSecondary }]}>
                Estimated 30 seconds
              </Text>
            </View>
            {busy && (
              <Text
                accessibilityRole="alert"
                style={[styles.small, { color: theme.textSecondary }]}
              >
                Starting the situation test…
              </Text>
            )}

            {savedAnalysis && followingAnalysis && !result && (
              <Group title="Analysis result">
                <AnalysisRow job={savedAnalysis} peek onPress={() => openTeam(savedAnalysis.id)} />
                {savedAnalysis.error && (
                  <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
                    {readableText(savedAnalysis.error)}
                  </Text>
                )}
                {savedAnalysis.status === "failed" && (
                  <Button label={savedAnalysis.submissionRejected ? "Edit situation" : "Reconnect analysis"} variant="tinted" size="large" onPress={() => {
                    if (savedAnalysis.submissionRejected) {
                      dismissAnalysis(savedAnalysis.id);
                      setFollowingAnalysis(false);
                      request.current = { signature: "", id: requestId() };
                      setError(null);
                    } else {
                      const id = retryAnalysis(savedAnalysis.id);
                      if (id) openTeam(id);
                    }
                  }} />
                )}
              </Group>
            )}

            {result && (
              <Group title="Analysis result">
                <Text
                  style={[
                    styles.resultTitle,
                    {
                      color:
                        result.status === "failed" || result.status === "configuration_required"
                          ? theme.danger
                          : result.decision === "propose"
                            ? theme.warning
                            : theme.text,
                    },
                  ]}
                >
                  {result.status === "configuration_required"
                    ? "Analysis needs configuration"
                    : quotaBlocked
                      ? "Analysis access needs attention"
                    : result.status === "failed"
                      ? "Analysis could not complete"
                      : result.status === "running"
                        ? "Analysis in progress"
                        : result.decision === "propose"
                          ? "Response proposed"
                          : result.decision === "insufficient_data"
                            ? "More observations needed"
                            : "No mobilization needed"}
                </Text>
                {result.error && (
                  <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
                    {analysisError(result.error, "This situation could not be analysed. No mobilization was created.")}
                  </Text>
                )}
                {quotaBlocked && (
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    Restore analysis credits or account limits before retrying.
                    Changing the test observations does not restore access. No mobilization was created.
                  </Text>
                )}
                {(result.status === "failed" || result.status === "configuration_required") && (
                  <Button
                    label={refreshingContext ? "Checking connection…" : quotaBlocked ? "Retry after restoring access" : "Retry analysis"}
                    variant="tinted"
                    size="large"
                    disabled={busy || refreshingContext}
                    onPress={() => void deliberateAttempt()}
                  />
                )}
                {result.status === "completed" && (
                  <Button
                    label="Run new analysis"
                    variant="plain"
                    size="large"
                    disabled={busy || refreshingContext}
                    onPress={() => void deliberateAttempt()}
                  />
                )}
                {savedAnalysis && result.status !== "running" && result.mobilizationIds.length === 0 && (
                  <Button label="Dismiss test result" variant="plain" size="large" onPress={() => {
                    dismissAnalysis(savedAnalysis.id);
                    router.dismissTo("/(mo)");
                  }} />
                )}
                {result.validationErrors.length > 0 && (
                  <Text style={[styles.body, { color: theme.danger }]}>
                    The proposed response did not pass the safety checks. No mobilization was created.
                    Review the observations or retry the analysis.
                  </Text>
                )}
                {result.status === "completed" && result.output && (
                  <>
                    <Text style={[styles.body, { color: theme.text }]}>
                      {readableText(result.output.assessment.summary, lookups)}
                    </Text>
                    {result.output.decision !== "propose" && missingObservations.length > 0 && (
                      <View style={styles.field}>
                        <Text style={[styles.label, { color: theme.text }]}>
                          Observations still needed
                        </Text>
                        {missingObservations.map((input, index) => (
                          <Text key={index} style={[styles.body, { color: theme.textSecondary }]}>
                            {input}
                          </Text>
                        ))}
                      </View>
                    )}
                    {result.output.mobilizations.map((mobilization, index) => {
                      const peopleNeeded = mobilization.tasks.reduce(
                        (total, task) => total + task.peopleNeeded, 0,
                      );
                      const teamCount = new Set(mobilization.tasks.map((task) => task.teamSlug)).size;
                      const savedId = result.mobilizationIds[index];
                      return (
                        <Card key={savedId ?? index} style={styles.factCard}>
                          <Text style={[styles.cardTitle, { color: theme.text }]}>
                            {readableText(mobilization.title, lookups)}
                          </Text>
                          <Text style={[styles.body, { color: theme.textSecondary }]}>
                            {peopleNeeded} people required across {teamCount} {teamCount === 1 ? "team" : "teams"}
                          </Text>
                          {savedId ? (
                            <Button
                              label="Review proposed mobilization"
                              variant="tinted"
                              size="large"
                              onPress={() =>
                                router.push({
                                  pathname: "/mobilize/[id]",
                                  params: { id: savedId },
                                })
                              }
                            />
                          ) : (
                            <Text style={[styles.small, { color: theme.danger }]}>
                              The saved proposal is unavailable. Run a new analysis before reviewing.
                            </Text>
                          )}
                        </Card>
                      );
                    })}
                  </>
                )}
                {result.snapshot && (
                  <View style={styles.observations}>
                    <Button
                      label={showInput ? "Hide observations used" : "View observations used"}
                      variant="plain"
                      size="large"
                      onPress={() => setShowInput((show) => !show)}
                    />
                    {showInput && result.snapshot.evidence.map((fact, index) => {
                      const observation = describeEvidence(fact, lookups);
                      return (
                        <View key={index} style={[styles.observation, { borderTopColor: theme.border }]}>
                          <Text style={[styles.label, { color: theme.text }]}>
                            {observation.title}
                          </Text>
                          <Text style={[styles.small, { color: theme.textSecondary }]}>
                            {observation.source}
                          </Text>
                          <Text style={[styles.small, { color: theme.textSecondary }]}>
                            {observation.observedAt}
                          </Text>
                          {observation.location && (
                            <Text style={[styles.small, { color: theme.textSecondary }]}>
                              {observation.location}
                            </Text>
                          )}
                          {observation.facts.map((value, factIndex) => (
                            <Text key={factIndex} style={[styles.body, { color: theme.text }]}>
                              {value}
                            </Text>
                          ))}
                        </View>
                      );
                    })}
                  </View>
                )}
              </Group>
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
    gap: 22,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  field: { gap: 7 },
  scenarioChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scenarioChoice: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderRadius: 10, justifyContent: "center", maxWidth: "100%" },
  label: { fontSize: Type.callout, fontWeight: "600" },
  body: { fontSize: Type.callout, lineHeight: 20 },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  analysisAction: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  analysisButton: { flexGrow: 1, flexBasis: 200 },
  analysisEstimate: { maxWidth: 110, flexShrink: 1 },
  factCard: { padding: 16, gap: 14 },
  cardTitle: { fontSize: Type.body, fontWeight: "600" },
  resultTitle: { fontSize: Type.title, fontWeight: "600" },
  observations: { gap: 12 },
  observation: { gap: 6, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
