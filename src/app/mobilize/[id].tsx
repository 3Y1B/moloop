import { useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Group } from "@/components/lead/group";
import { openTaskSheet } from "@/components/lead/open-sheet";
import { Sheet, SheetTitle } from "@/components/lead/sheet";
import { approvalAllowed, approvalCrewPreview, reviewApprovalAnalysis } from "@/components/mobilization/approval-review";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, Separator } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusLine } from "@/components/ui/status-line";
import { Type } from "@/constants/theme";
import {
  useLookups,
  useMe,
  useMobilization,
  useMobilizationStatus,
  useNow,
  useRepo,
  useSnapshot,
} from "@/data/hooks";
import { useTheme } from "@/hooks/use-theme";
import { isBusy } from "@/lib/lifecycle";
import type { SimulationRunResult } from "@/lib/mobilization-contracts";
import { goBack } from "@/lib/navigation";

/** The saved plan stays visible while live task replies change staffing. */
export default function MobilizeSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const snapshot = useSnapshot();
  const now = useNow();
  const { tasks, proposals } = snapshot;
  const { volunteers, teams, zones } = useLookups();
  const mobilization = useMobilization(id);
  const status = useMobilizationStatus(mobilization);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisReload, setAnalysisReload] = useState(0);
  const [acknowledgedReview, setAcknowledgedReview] = useState<string | null>(null);
  const [approvalNeedsReview, setApprovalNeedsReview] = useState(false);
  const [loadedAnalysis, setLoadedAnalysis] = useState<{
    runId: string;
    value: SimulationRunResult | null;
    error: string | null;
  } | null>(null);
  const mo = me?.role === "coordinator";
  const wantedRunId = mo ? mobilization?.analysisRunId : null;
  const matchingAnalysis =
    wantedRunId && loadedAnalysis?.runId === wantedRunId ? loadedAnalysis : null;
  const analysis = matchingAnalysis?.value ?? null;
  const analysisError = matchingAnalysis?.error ?? null;
  const analysisLoading = !!wantedRunId && !matchingAnalysis;
  const zoneName = (slug: string | null) => (slug ? (zones[slug]?.name ?? slug) : "Whole event");

  useEffect(() => {
    let live = true;
    if (!wantedRunId || !repo.mobilizations) return;
    void repo.mobilizations
      .getRun(wantedRunId)
      .then((run) => {
        if (live) setLoadedAnalysis({ runId: wantedRunId, value: run, error: null });
      })
      .catch((cause) => {
        if (live)
          setLoadedAnalysis({
            runId: wantedRunId,
            value: null,
            error: cause instanceof Error ? cause.message : "Could not load the saved analysis.",
          });
      });
    return () => {
      live = false;
    };
  }, [wantedRunId, repo, analysisReload]);

  if (!mobilization || !status)
    return (
      <Sheet>
        <SheetTitle title="Mobilization" />
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {snapshot.status === "loading"
            ? "Loading mobilization…"
            : snapshot.status === "error"
              ? "Could not load this mobilization. Check your connection and try again."
              : "This mobilization is no longer available."}
        </Text>
        <Button label="Back" variant="tinted" size="large" onPress={() => goBack()} />
      </Sheet>
    );

  const pending = mobilization.status === "proposed";
  const permitted =
    mo ||
    (me?.role === "team_lead" &&
      !pending &&
      mobilization.steps.some((step) => step.teamSlug === me.teamSlug));
  if (!permitted)
    return (
      <Sheet>
        <SheetTitle title="Mobilization" />
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          This response plan is available to Mo and the teams taking part.
        </Text>
      </Sheet>
    );
  const visibleSteps = mobilization.steps.filter((step) => mo || step.teamSlug === me?.teamSlug);
  const allTasks = Object.values(tasks);
  const evidence = mobilization.evidence;
  const approvalReview = reviewApprovalAnalysis(mobilization, analysis);
  const crewPreview = approvalCrewPreview(mobilization, volunteers, allTasks, now);
  const hasApprovalGaps = approvalNeedsReview || crewPreview.gap > 0 || approvalReview.missingInputs.length > 0 ||
    approvalReview.requiredActions.some((action) => action.unmet.length > 0);
  // A changed run, plan or staffing preview requires a new, deliberate acknowledgement.
  const reviewKey = JSON.stringify({ id: mobilization.id, runId: analysis?.runId,
    actions: approvalReview.requiredActions, missing: approvalReview.missingInputs, crew: crewPreview });
  const acknowledged = acknowledgedReview === reviewKey;
  const canApprove = approvalAllowed({ analysisReady: approvalReview.ready,
    hasGaps: hasApprovalGaps, acknowledged, busy });
  const decidedBy = mobilization.decidedById ? volunteers[mobilization.decidedById]?.name : null;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update this mobilization. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet>
      <SheetTitle eyebrow={status.label} title={mobilization.title} />
      <View style={styles.meta}>
        <Text style={[styles.location, { color: theme.text }]}>
          {zoneName(mobilization.zoneSlug)}
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {mobilization.urgency} priority
        </Text>
      </View>
      <Text style={[styles.body, { color: theme.textSecondary }]}>{mobilization.rationale}</Text>

      {mo && (
        <Group title="Approval safety review">
          {pending && (
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Approval starts the proposed tasks. It does not resolve missing observations, complete unmet SOP actions or guarantee staffing.
            </Text>
          )}
          {pending && (
            <View style={styles.fact}>
              <Text style={[styles.location, { color: theme.text }]}>
                {crewPreview.required} crew required · {crewPreview.eligible} eligible saved suggestions
              </Text>
              <Text style={[styles.body, { color: crewPreview.gap ? theme.text : theme.textSecondary }]}>
                {crewPreview.gap} slots not covered by the preview. Availability is checked again on approval.
              </Text>
            </View>
          )}
          {mobilization.analysisRunId && !approvalReview.ready && (
            <>
              <Text accessibilityRole="alert" style={[styles.body, { color: theme.text }]}>
                {analysisLoading ? "Saved analysis must finish loading before approval." : analysisError ?? approvalReview.error}
              </Text>
              {!analysisLoading && (
                <Button label="Reload saved analysis" variant="tinted" size="large" disabled={busy}
                  onPress={() => { setLoadedAnalysis(null); setAnalysisReload((value) => value + 1); }} />
              )}
            </>
          )}
          {!mobilization.analysisRunId && (
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              This older or manual plan has no linked AI analysis; no saved SOP coverage assessment is available.
            </Text>
          )}
          {approvalReview.ready && approvalReview.siblingCount > 0 && (
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              This analysis produced {approvalReview.siblingCount + 1} mobilizations. Review their shared requirements below; approving this plan does not approve the others.
            </Text>
          )}
          {approvalReview.ready && approvalReview.missingInputs.length > 0 && (
            <Group title="Unresolved observations" count={approvalReview.missingInputs.length}>
              {approvalReview.missingInputs.map((input) => (
                <Text key={input} style={[styles.small, { color: theme.text }]}>{input}</Text>
              ))}
            </Group>
          )}
          {approvalReview.ready && approvalReview.requiredActions.length > 0 && (
            <Group title="Required SOP action coverage" count={approvalReview.requiredActions.length}>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Planned means full proposed coverage, not completed work. Tasks without a SOP reference are independent or partial; they do not satisfy an unmet action.
              </Text>
              {approvalReview.requiredActions.map((action) => (
                <View key={`${action.ref.slug}:${action.ref.version}:${action.ref.actionId}`}
                  style={[styles.requirement, { borderLeftColor: action.unmet.length ? theme.warning : theme.separator }]}>
                  <Text style={[styles.location, { color: theme.text }]}>
                    {action.unmet.length ? "Unmet" : "Planned"}: {action.title}
                  </Text>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>
                    {action.playbookTitle} v{action.ref.version} · {teams[action.teamSlug]?.name ?? action.teamSlug}
                  </Text>
                  <Text style={[styles.body, { color: theme.text }]}>{action.instructions}</Text>
                  {action.plannedBy.map((plan, index) => (
                    <Text key={index} style={[styles.small, { color: theme.textSecondary }]}>
                      {plan.current ? "Planned in this mobilization" : `Planned in another mobilization: ${plan.title}`}
                    </Text>
                  ))}
                  {action.unmet.map((item, index) => (
                    <View key={index} style={styles.fact}>
                      <Text style={[styles.small, { color: theme.textSecondary }]}>
                        {item.current ? "Unmet in this mobilization" : `Unmet in another mobilization: ${item.title}`}
                      </Text>
                      <Text style={[styles.body, { color: theme.text }]}>{item.reason}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </Group>
          )}
        </Group>
      )}

      {analysisLoading && (
        <Text style={[styles.small, { color: theme.textSecondary }]}>Loading saved analysis…</Text>
      )}
      {analysisError && (
        <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
          {analysisError}
        </Text>
      )}
      {analysis?.output && (
        <Group title="Situation assessment">
          <Text style={[styles.body, { color: theme.text }]}>
            {analysis.output.assessment.summary}
          </Text>
          {analysis.output.assessment.playbookAssessments?.length > 0 && (
            <Group
              title="Playbook review"
              count={analysis.output.assessment.playbookAssessments.length}
            >
              {analysis.output.assessment.playbookAssessments.map((review) => (
                <Card key={`${review.slug}-${review.version}`} style={styles.facts}>
                  <Text style={[styles.location, { color: theme.text }]}>
                    {analysis.snapshot?.playbooks.find(
                      (playbook) =>
                        playbook.content.slug === review.slug &&
                        playbook.version === review.version,
                    )?.content.title ?? review.slug}{" "}
                    · Version {review.version}
                  </Text>
                  <Text
                    style={[
                      styles.location,
                      {
                        color:
                          review.applicability === "insufficient_data" ? theme.warning : theme.text,
                      },
                    ]}
                  >
                    {review.applicability === "applicable"
                      ? "Applies"
                      : review.applicability === "not_applicable"
                        ? "No activation signal in this scenario"
                        : "More observations needed"}
                  </Text>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>{review.reason}</Text>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>
                    Sources: {review.evidenceRefs.join(", ")}
                  </Text>
                  {review.missingInputs.length > 0 && (
                    <Text style={[styles.small, { color: theme.warning }]}>
                      Missing inputs: {review.missingInputs.join(", ")}
                    </Text>
                  )}
                  {analysis.snapshot?.playbooks
                    .find(
                      (playbook) =>
                        playbook.content.slug === review.slug &&
                        playbook.version === review.version,
                    )
                    ?.content.decisionPoints?.map((decision) => (
                      <View key={decision.id} style={styles.fact}>
                        <Text style={[styles.location, { color: theme.text }]}>Mo decides</Text>
                        <Text style={[styles.body, { color: theme.textSecondary }]}>
                          {decision.question}
                        </Text>
                      </View>
                    ))}
                </Card>
              ))}
            </Group>
          )}
          {analysis.output.assessment.findings.map((finding) => (
            <View key={finding.id} style={styles.fact}>
              <Text style={[styles.location, { color: theme.text }]}>{finding.risk}</Text>
              {finding.possibleCause && (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  {finding.possibleCause}
                </Text>
              )}
              {finding.uncertainty && (
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  Uncertainty: {finding.uncertainty}
                </Text>
              )}
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Sources: {finding.evidenceRefs.join(", ")}
              </Text>
            </View>
          ))}
          {analysis.output.assessment.missingInputs.map((input, index) => (
            <Text key={index} style={[styles.small, { color: theme.warning }]}>
              Missing observation: {input}
            </Text>
          ))}
        </Group>
      )}

      {analysis?.snapshot && (
        <Group title="Saved observations">
          <Text style={[styles.small, { color: theme.textSecondary }]}>
            {new Date(analysis.snapshot.evaluatedAt).toLocaleString()}
          </Text>
          <Card style={styles.facts}>
            {analysis.snapshot.evidence.map((fact) => (
              <View key={fact.ref} style={styles.fact}>
                <Text style={[styles.location, { color: theme.text }]}>
                  {fact.ref} · {fact.kind.replaceAll("_", " ")}
                  {" · "}
                  {fact.source === "manual_demo" ? "Hypothetical" : "Recorded"}
                </Text>
                <Text selectable style={[styles.small, { color: theme.textSecondary }]}>
                  {fact.zoneSlug ? `${zoneName(fact.zoneSlug)} · ` : ""}
                  {JSON.stringify(fact.value)}
                </Text>
              </View>
            ))}
          </Card>
        </Group>
      )}

      {!analysis && evidence ? (
        <Group title="Observations at detection">
          <Text style={[styles.small, { color: theme.textSecondary }]}>
            {new Date(evidence.observedAt).toLocaleString()} · {evidence.windowMinutes}-minute
            incident window
          </Text>
          <Card style={styles.facts}>
            <Text style={[styles.body, { color: theme.text }]}>
              {evidence.weather.tempC}°C, {evidence.weather.trendCPerHour > 0 ? "+" : ""}
              {evidence.weather.trendCPerHour}°C per hour
            </Text>
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {evidence.weather.activeWarnings.length
                ? `Weather warning: ${evidence.weather.activeWarnings.join(", ")}`
                : "No active weather warning"}
            </Text>
            {evidence.incidents.map((incident, index) => (
              <View key={`${incident.zoneSlug}-${incident.category}-${index}`} style={styles.fact}>
                <Text style={[styles.body, { color: theme.text }]}>
                  {incident.count} {incident.category.replaceAll("_", " ")} reports at{" "}
                  {zoneName(incident.zoneSlug)}
                </Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  {incident.openCount} open
                  {incident.sampleTitles.length ? ` · ${incident.sampleTitles.join("; ")}` : ""}
                </Text>
              </View>
            ))}
            {evidence.lineup.map((set, index) => (
              <View key={`${set.stageSlug}-${index}`} style={styles.fact}>
                <Text style={[styles.body, { color: theme.text }]}>
                  {set.act} at {zoneName(set.stageSlug)}
                </Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  {set.minutesUntil <= 0 ? "Underway" : `Starts in ${set.minutesUntil} min`} ·{" "}
                  {set.expectedDraw} expected crowd
                </Text>
              </View>
            ))}
          </Card>
        </Group>
      ) : !analysis && !analysisLoading && !mobilization.analysisRunId ? (
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          No historical observations were saved for this plan.
        </Text>
      ) : null}

      <Text style={[styles.sectionSummary, { color: theme.text }]}>
        {visibleSteps.length} response tasks ·{" "}
        {visibleSteps.reduce((sum, step) => sum + step.peopleNeeded, 0)} crew required
      </Text>
      {visibleSteps.map((step, index) => {
        const stepStatus = step.stepKey
          ? status.steps.find((item) => item.stepKey === step.stepKey)
          : status.steps[mobilization.steps.indexOf(step)];
        const task = stepStatus?.taskId ? tasks[stepStatus.taskId] : undefined;
        const crew = task
          ? [
              ...(task.assigneeId
                ? [
                    {
                      id: task.assigneeId,
                      label:
                        task.status === "assigned"
                          ? "Awaiting reply"
                          : task.status === "queued"
                            ? "Queued"
                            : task.status === "resolved"
                              ? "Completed"
                              : task.status === "cancelled"
                                ? "Task closed"
                                : "Confirmed",
                    },
                  ]
                : []),
              ...task.helpers.map((helper) => ({
                id: helper.volunteerId,
                label:
                  task.status === "resolved"
                    ? "Completed"
                    : task.status === "cancelled"
                      ? "Task closed"
                      : helper.status === "accepted"
                        ? "Confirmed"
                        : "Awaiting reply",
              })),
            ]
          : [];
        return (
          <Group
            key={step.stepKey ?? `${step.teamSlug}-${index}`}
            title={step.title ?? teams[step.teamSlug]?.name ?? step.teamSlug}
          >
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {teams[step.teamSlug]?.name ?? step.teamSlug} ·{" "}
              {zoneName(step.zoneSlug ?? mobilization.zoneSlug)} · {step.peopleNeeded} crew required
            </Text>
            <Text style={[styles.body, { color: theme.text }]}>
              {step.instructions ?? step.reason}
            </Text>
            {step.instructions && step.reason !== step.instructions && (
              <Text style={[styles.small, { color: theme.textSecondary }]}>{step.reason}</Text>
            )}
            {step.requiredSkills?.length ? (
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Skills: {step.requiredSkills.join(", ")}
              </Text>
            ) : null}
            {step.completionCriteria && (
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Complete when: {step.completionCriteria}
              </Text>
            )}
            {step.evidenceRefs?.length ? (
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Sources: {step.evidenceRefs.join(", ")}
              </Text>
            ) : null}
            {pending ? (
              <>
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  Suggested crew. Availability is checked again when Mo approves.
                </Text>
                {step.candidates.length > 0 && (
                  <Card>
                    {step.candidates
                      .slice(0, step.peopleNeeded)
                      .map((candidate, candidateIndex) => {
                        const volunteer = volunteers[candidate.volunteerId];
                        return (
                          <Fragment key={candidate.volunteerId}>
                            {candidateIndex > 0 && <Separator inset={58} />}
                            <View style={styles.person}>
                              <Avatar
                                name={volunteer?.name ?? "Crew member"}
                                color={teams[step.teamSlug]?.color}
                                size={30}
                              />
                              <View style={styles.flex}>
                                <Text style={[styles.body, { color: theme.text }]}>
                                  {volunteer?.name ?? "Crew member"}
                                </Text>
                                <Text style={[styles.small, { color: theme.textSecondary }]}>
                                  {isBusy(allTasks, candidate.volunteerId)
                                    ? "Now busy. May be replaced on approval."
                                    : candidate.rationale}
                                </Text>
                              </View>
                            </View>
                          </Fragment>
                        );
                      })}
                  </Card>
                )}
                {stepStatus?.previewMissingCount ? (
                  <Text style={[styles.body, { color: theme.warning }]}>
                    {stepStatus.previewMissingCount} more crew needed
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {stepStatus && (
                  <Text style={[styles.body, { color: theme.text }]}>
                    {stepStatus.terminal
                      ? stepStatus.taskStatus === "resolved"
                        ? "Task completed"
                        : "Task closed"
                      : `${stepStatus.confirmedCount} confirmed · ${stepStatus.waitingCount} awaiting reply · ${stepStatus.missingCount} unfilled`}
                  </Text>
                )}
                {crew.length > 0 && (
                  <Card>
                    {crew.map((person, personIndex) => (
                      <Fragment key={person.id}>
                        {personIndex > 0 && <Separator inset={58} />}
                        <View style={styles.person}>
                          <Avatar
                            name={volunteers[person.id]?.name ?? "Crew member"}
                            color={teams[step.teamSlug]?.color}
                            size={30}
                          />
                          <View style={styles.flex}>
                            <Text style={[styles.body, { color: theme.text }]}>
                              {volunteers[person.id]?.name ?? "Crew member"}
                            </Text>
                            <Text style={[styles.small, { color: theme.textSecondary }]}>
                              {person.label}
                            </Text>
                          </View>
                        </View>
                      </Fragment>
                    ))}
                  </Card>
                )}
                {task && (
                  <Button
                    label="Open task"
                    variant="tinted"
                    size="large"
                    onPress={() => openTaskSheet(task, proposals)}
                  />
                )}
              </>
            )}
          </Group>
        );
      })}

      {mobilization.decidedAt && (
        <Text style={[styles.small, { color: theme.textSecondary }]}>
          {decidedBy ? `${decidedBy} · ` : ""}
          {new Date(mobilization.decidedAt).toLocaleString()}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>
          {error}
        </Text>
      )}
      {pending && mo && approvalNeedsReview && (
        <Text style={[styles.small, { color: theme.text }]}>
          Approval could not be confirmed. Check the plan status and review the reported issue and current staffing before reloading and trying again.
        </Text>
      )}
      {pending && mo && repo.mobilizations && (
        <>
        {approvalReview.ready && hasApprovalGaps && (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged, disabled: busy }}
            accessibilityLabel="I understand the unresolved SOP, observation and staffing gaps and choose to approve this plan"
            disabled={busy} onPress={() => setAcknowledgedReview(acknowledged ? null : reviewKey)}
            style={[styles.acknowledgement, { borderColor: acknowledged ? theme.tint : theme.border }]}>
            <Icon sf={acknowledged ? "checkmark.square.fill" : "square"} md={acknowledged ? "check_box" : "check_box_outline_blank"}
              size={24} color={acknowledged ? theme.tint : theme.textSecondary} />
            <Text style={[styles.body, styles.flex, { color: theme.text }]}>
              I understand the unresolved SOP, observation and staffing gaps and choose to approve this plan.
            </Text>
          </Pressable>
        )}
        <View style={styles.actions}>
          <Button
            label={busy ? "Updating…" : "Reject"}
            variant="tinted"
            color={theme.danger}
            size="large"
            disabled={busy}
            onPress={() => void run(() => repo.mobilizations!.reject(mobilization.id))}
            style={styles.flex}
          />
          <Button
            label={busy ? "Updating…" : "Approve"}
            sf="checkmark"
            size="large"
            disabled={!canApprove}
            onPress={() => {
              if (canApprove) void run(async () => {
                try {
                  await repo.mobilizations!.approve(mobilization.id, {
                    reviewedRunId: mobilization.analysisRunId ?? undefined,
                    acknowledgeGaps: acknowledged,
                  });
                } catch (cause) {
                  setAcknowledgedReview(null);
                  setApprovalNeedsReview(true);
                  throw cause;
                }
              });
            }}
            style={styles.flex}
          />
        </View>
        </>
      )}
      {mobilization.status === "active" && mo && repo.mobilizations && (
        <Button
          label={busy ? "Updating…" : "Stand down"}
          variant="tinted"
          color={theme.danger}
          size="large"
          disabled={busy}
          onPress={() =>
            void run(() => repo.mobilizations!.standDown(mobilization.id, "stood_down"))
          }
        />
      )}
      {!pending && mobilization.status !== "active" && (
        <StatusLine status={status} size="callout" />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: Type.callout, lineHeight: 21 },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  location: { fontSize: Type.callout, fontWeight: "600" },
  meta: { gap: 3 },
  facts: { padding: 14, gap: 8 },
  fact: { gap: 2, marginTop: 3 },
  person: { flexDirection: "row", gap: 12, alignItems: "center", padding: 14, minHeight: 58 },
  sectionSummary: { fontSize: Type.title, fontWeight: "600", marginTop: 6 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  linkLabel: { flex: 1, fontSize: Type.callout, textTransform: "capitalize" },
  actions: { flexDirection: "row", gap: 10 },
  requirement: { gap: 5, paddingVertical: 10, paddingLeft: 12, borderLeftWidth: 2 },
  acknowledgement: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1, borderRadius: 12, minHeight: 56 },
  flex: { flex: 1 },
});
