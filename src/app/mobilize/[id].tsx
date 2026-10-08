import { router, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sheet, SheetTitle } from "@/components/lead/sheet";
import { approvalAllowed, approvalCrewPreview, reviewApprovalAnalysis } from "@/components/mobilization/approval-review";
import { MobilizationJustification } from "@/components/mobilization/justification";
import { canViewMobilization, detailStep, operationalDetails, taskForStep, taskProgressLabel } from "@/components/mobilization/presentation";
import { humanizeMissingInputs, readableName, readableText } from "@/components/mobilization/readable-analysis";
import { MobilizationTaskDetails } from "@/components/mobilization/task-details";
import { Button } from "@/components/ui/button";
import { Card, Separator } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Type } from "@/constants/theme";
import { useLookups, useMe, useMobilization, useMobilizationStatus, useNow, useRepo, useSnapshot } from "@/data/hooks";
import { useTheme } from "@/hooks/use-theme";
import type { SimulationRunResult } from "@/lib/mobilization-contracts";
import { goBack } from "@/lib/navigation";

/** Overview, operational detail and justification are separate navigation entries. */
export default function MobilizeSheet() {
  const { id, view, step: requestedStep } = useLocalSearchParams<{ id: string; view?: string; step?: string }>();
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const snapshot = useSnapshot();
  const now = useNow();
  const { volunteers, teams, zones } = useLookups();
  const mobilization = useMobilization(id);
  const status = useMobilizationStatus(mobilization);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisReload, setAnalysisReload] = useState(0);
  const [acknowledgedReview, setAcknowledgedReview] = useState<string | null>(null);
  const [approvalNeedsReview, setApprovalNeedsReview] = useState(false);
  const [loadedAnalysis, setLoadedAnalysis] = useState<{ runId: string; value: SimulationRunResult | null; failed: boolean } | null>(null);
  const mo = me?.role === "coordinator";
  const wantedRunId = mo ? mobilization?.analysisRunId : null;
  const matchingAnalysis = wantedRunId && loadedAnalysis?.runId === wantedRunId ? loadedAnalysis : null;
  const analysis = matchingAnalysis?.value ?? null;
  const analysisLoading = !!wantedRunId && !matchingAnalysis;
  const lookups = { zones, teams, skills: analysis?.snapshot?.skills };
  const text = (value: string) => readableText(value, lookups);

  useEffect(() => {
    let live = true;
    if (!wantedRunId || !repo.mobilizations) return;
    void repo.mobilizations.getRun(wantedRunId)
      .then((value) => { if (live) setLoadedAnalysis({ runId: wantedRunId, value, failed: false }); })
      .catch(() => { if (live) setLoadedAnalysis({ runId: wantedRunId, value: null, failed: true }); });
    return () => { live = false; };
  }, [wantedRunId, repo, analysisReload]);

  const reloadAnalysis = () => { setLoadedAnalysis(null); setAnalysisReload((value) => value + 1); };
  if (!mobilization || !status) return (
    <Sheet>
      <SheetTitle title="Mobilization" />
      <Text style={[styles.body, { color: theme.textSecondary }]}>{snapshot.status === "loading" ? "Loading mobilization…" : snapshot.status === "error" ? "Could not load this mobilization. Check your connection and try again." : "This mobilization is no longer available."}</Text>
      <Button label="Back" variant="tinted" onPress={() => goBack()} />
    </Sheet>
  );
  if (!canViewMobilization(mobilization, me) || (view === "justification" && !mo)) return (
    <Sheet>
      <SheetTitle title="Mobilization" />
      <Text style={[styles.body, { color: theme.textSecondary }]}>This page is not available to your role.</Text>
      <Button label="Back" variant="plain" onPress={() => goBack()} />
    </Sheet>
  );

  const pending = mobilization.status === "proposed";
  const allTasks = Object.values(snapshot.tasks);
  const visibleSteps = mobilization.steps.map((step, index) => ({ step, index }))
    .filter(({ step }) => mo || step.teamSlug === me?.teamSlug);
  const approvalReview = reviewApprovalAnalysis(mobilization, analysis);
  const crewPreview = approvalCrewPreview(mobilization, volunteers, allTasks, now);
  const missingInputs = humanizeMissingInputs(approvalReview.missingInputs, lookups);
  const unmetCount = approvalReview.requiredActions.filter((action) => action.unmet.length > 0).length;
  const hasApprovalGaps = approvalNeedsReview || crewPreview.gap > 0 || approvalReview.missingInputs.length > 0 || unmetCount > 0;
  // Preserve the exact audit and fresh staffing acknowledgement, without displaying its technical identity.
  const reviewKey = JSON.stringify({ id: mobilization.id, runId: analysis?.runId,
    actions: approvalReview.requiredActions, missing: approvalReview.missingInputs, crew: crewPreview });
  const acknowledged = acknowledgedReview === reviewKey;
  const canApprove = approvalAllowed({ analysisReady: approvalReview.ready, hasGaps: hasApprovalGaps, acknowledged, busy });

  if (view === "task") {
    const step = detailStep(mobilization, requestedStep, me);
    if (!step) return <Sheet><SheetTitle title="Task unavailable" /><Text style={[styles.body, { color: theme.textSecondary }]}>This task is no longer available to your team.</Text><Button label="Back to mobilization" variant="plain" onPress={() => goBack({ pathname: "/mobilize/[id]", params: { id } })} /></Sheet>;
    const index = mobilization.steps.indexOf(step);
    return <MobilizationTaskDetails plan={mobilization} step={step} status={status.steps[index]}
      tasks={allTasks} preview={crewPreview.steps[index]} volunteers={volunteers} teams={teams}
      lookups={lookups} proposals={snapshot.proposals} />;
  }
  if (view === "justification") return <MobilizationJustification plan={mobilization} analysis={analysis}
    loading={analysisLoading} review={approvalReview} lookups={lookups} reload={reloadAnalysis} />;

  const entries = visibleSteps.map(({ step, index }) => {
    const task = taskForStep(mobilization, step, allTasks);
    return { step, index, task, detail: operationalDetails(mobilization, step, task) };
  });
  const people = entries.reduce((sum, entry) => sum + entry.detail.peopleNeeded, 0);
  const teamCount = new Set(entries.map((entry) => entry.detail.teamSlug)).size;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); }
    catch { setError("The plan could not be updated. Check its status and current staffing before trying again."); }
    finally { setBusy(false); }
  };

  return (
    <Sheet>
      <SheetTitle title={text(mobilization.title)} />
      <Text style={[styles.counts, { color: theme.textSecondary }]}>{people} {people === 1 ? "person" : "people"} required · {teamCount} {teamCount === 1 ? "team" : "teams"}</Text>
      <Card>
        {entries.map(({ step, index, task, detail }, rowIndex) => <Fragment key={step.stepKey ?? index}>
          {rowIndex > 0 && <Separator inset={14} />}
          <Pressable accessibilityRole="button" accessibilityLabel={`View task: ${text(detail.title)}`}
            accessibilityHint="Opens the task instructions, location and people needed"
            onPress={() => router.push({ pathname: "/mobilize/[id]", params: { id, view: "task", step: String(index) } })}
            style={({ pressed }) => [styles.taskRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
            <View style={styles.flex}>
              <Text style={[styles.taskTitle, { color: theme.text }]}>{text(detail.title)}</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>{readableName("team", detail.teamSlug, lookups)} · {detail.peopleNeeded} {detail.peopleNeeded === 1 ? "person" : "people"}</Text>
              {!pending && <Text style={[styles.small, { color: theme.textSecondary }]}>{taskProgressLabel(mobilization, task, status.steps[index])}</Text>}
            </View>
            <Icon sf="chevron.right" md="chevron_right" size={16} color={theme.textTertiary} />
          </Pressable>
        </Fragment>)}
      </Card>

      {mo && <Pressable accessibilityRole="button" accessibilityLabel="View justification"
        onPress={() => router.push({ pathname: "/mobilize/[id]", params: { id, view: "justification" } })}
        style={({ pressed }) => [styles.justification, { borderColor: theme.separator }, pressed && { backgroundColor: theme.backgroundSelected }]}>
        <View style={styles.flex}>
          <Text style={[styles.taskTitle, { color: theme.text }]}>Justification</Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>Situation, observations and response rules</Text>
        </View>
        <Icon sf="chevron.right" md="chevron_right" size={16} color={theme.textTertiary} />
      </Pressable>}

      <Text style={[styles.small, { color: theme.textSecondary }]}>{status.label}</Text>
      {pending && mo && <View style={styles.review}>
        {crewPreview.gap > 0 && <Text style={[styles.small, { color: theme.warning }]}>{crewPreview.gap} {crewPreview.gap === 1 ? "place is" : "places are"} not covered by the candidate preview. Approval checks available crew again.</Text>}
        {approvalReview.ready && (missingInputs.length > 0 || unmetCount > 0) && <Text style={[styles.small, { color: theme.warning }]}>{missingInputs.length} observations need confirmation · {unmetCount} response actions not fully covered. See Justification before approving.</Text>}
        {approvalReview.ready && approvalReview.siblingCount > 0 && <Text style={[styles.small, { color: theme.textSecondary }]}>This approves only this mobilization, not the other {approvalReview.siblingCount === 1 ? "plan" : "plans"} from the same analysis.</Text>}
        {!mobilization.analysisRunId && <Text style={[styles.small, { color: theme.textSecondary }]}>No saved AI assessment is linked to this older or manually created plan.</Text>}
        {!approvalReview.ready && <>
          <Text accessibilityRole="alert" style={[styles.small, { color: theme.danger }]}>{analysisLoading ? "Loading the saved assessment before approval…" : matchingAnalysis?.failed ? "The saved assessment could not be loaded. Try again before approving." : "The saved assessment could not be verified against this plan. Reload it before approving."}</Text>
          {!analysisLoading && <Button label="Reload assessment" variant="plain" disabled={busy} onPress={reloadAnalysis} />}
        </>}
        <Text style={[styles.small, { color: theme.textSecondary }]}>Approval creates the tasks and starts staffing. It does not complete the response actions or resolve the outstanding gaps.</Text>
      </View>}
      {error && <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>{error}</Text>}
      {pending && mo && approvalNeedsReview && <Text style={[styles.small, { color: theme.textSecondary }]}>Approval was not confirmed. Review the current plan and staffing before trying again.</Text>}
      {pending && mo && repo.mobilizations && <>
        {approvalReview.ready && hasApprovalGaps && <Pressable accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledged, disabled: busy }} disabled={busy}
          accessibilityLabel="I have reviewed the staffing gaps, missing observations and response actions still not covered"
          onPress={() => setAcknowledgedReview(acknowledged ? null : reviewKey)}
          style={[styles.acknowledgement, { borderColor: acknowledged ? theme.tint : theme.border }]}>
          <Icon sf={acknowledged ? "checkmark.square.fill" : "square"} md={acknowledged ? "check_box" : "check_box_outline_blank"} size={24} color={acknowledged ? theme.tint : theme.textSecondary} />
          <Text style={[styles.small, styles.flex, { color: theme.text }]}>I have reviewed the staffing gaps, missing observations and response actions still not covered.</Text>
        </Pressable>}
        <View style={styles.actions}>
          <Button label={busy ? "Updating…" : "Reject"} variant="tinted" color={theme.danger} size="large" disabled={busy} onPress={() => void run(() => repo.mobilizations!.reject(id))} style={styles.flex} />
          <Button label={busy ? "Updating…" : "Approve"} size="large" disabled={!canApprove} style={styles.flex}
            onPress={() => { if (canApprove) void run(async () => {
              try { await repo.mobilizations!.approve(id, { reviewedRunId: mobilization.analysisRunId ?? undefined, acknowledgeGaps: acknowledged }); }
              catch (cause) { setAcknowledgedReview(null); setApprovalNeedsReview(true); throw cause; }
            }); }} />
        </View>
      </>}
      {mobilization.status === "active" && mo && repo.mobilizations && <>
        <Text style={[styles.small, { color: theme.textSecondary }]}>Standing down ends this mobilization. Existing tasks remain open until they are completed or closed.</Text>
        <Button label={busy ? "Updating…" : "Stand down"} variant="tinted" color={theme.danger} size="large" disabled={busy} onPress={() => void run(() => repo.mobilizations!.standDown(id, "stood_down"))} />
      </>}
      <Button label="Back" variant="plain" onPress={() => goBack()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: Type.body, lineHeight: 23 },
  small: { fontSize: Type.footnote, lineHeight: 19 },
  counts: { fontSize: Type.title - 1, fontWeight: "500", lineHeight: 24, marginTop: -4, marginBottom: 4 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 76, padding: 14 },
  taskTitle: { fontSize: Type.body, fontWeight: "600", lineHeight: 22 },
  justification: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  review: { gap: 8 },
  flex: { flex: 1, gap: 4 },
  actions: { flexDirection: "row", gap: 10 },
  acknowledgement: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1, borderRadius: 12, minHeight: 56 },
});
