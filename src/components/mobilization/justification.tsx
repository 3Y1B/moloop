import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Group } from "@/components/lead/group";
import { Sheet, SheetTitle } from "@/components/lead/sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { PlanningEvidence, SimulationRunResult } from "@/lib/mobilization-contracts";
import { goBack } from "@/lib/navigation";
import type { Mobilization } from "@/lib/schema";
import type { ApprovalAnalysisReview } from "./approval-review";
import { describeEvidence, humanizeMissingInputs, readableName, readableText, type ReadableLookups } from "./readable-analysis";

/** Every detail is readable copy. Technical references remain internal to the saved audit. */
export function MobilizationJustification({ plan, analysis, loading, review, lookups, reload }: {
  plan: Mobilization; analysis: SimulationRunResult | null; loading: boolean;
  review: ApprovalAnalysisReview; lookups: ReadableLookups; reload: () => void;
}) {
  const theme = useTheme();
  const text = (value: string) => readableText(value, lookups);
  const output = analysis?.status === "completed" ? analysis.output : null;
  const captured = analysis?.snapshot;
  const missing = humanizeMissingInputs(review.missingInputs, lookups);
  const neededBooks = new Set(review.requiredActions.map((action) => `${action.ref.slug}:${action.ref.version}`));
  const relevantReviews = output?.assessment.playbookAssessments.filter((item) => item.applicability !== "not_applicable" || neededBooks.has(`${item.slug}:${item.version}`)) ?? [];
  const unusedReviews = output?.assessment.playbookAssessments.filter((item) => item.applicability === "not_applicable" && !neededBooks.has(`${item.slug}:${item.version}`)) ?? [];
  const findingRefs = new Set(output?.assessment.findings.flatMap((finding) => finding.evidenceRefs) ?? []);
  const otherEvidence = captured?.evidence.filter((item) => !findingRefs.has(item.ref)) ?? [];
  const evidenceFor = (references: string[]) => captured?.evidence.filter((item) => references.includes(item.ref)) ?? [];
  const titleFor = (slug: string, version: number) => captured?.playbooks.find((book) => book.content.slug === slug && book.version === version)?.content.title ?? "Saved response playbook";

  return (
    <Sheet>
      <Button label="Back to mobilization" variant="plain" onPress={() => goBack({ pathname: "/mobilize/[id]", params: { id: plan.id } })} />
      <SheetTitle title="Justification" />
      <Text style={[styles.small, { color: theme.textSecondary }]}>{text(plan.title)}</Text>
      <Group title="Why this mobilization">
        <Text style={[styles.body, { color: theme.text }]}>{text(plan.rationale)}</Text>
      </Group>
      {loading && <Text style={[styles.body, { color: theme.textSecondary }]}>Loading the saved assessment…</Text>}
      {plan.analysisRunId && !loading && !review.ready && <>
        <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>The saved assessment could not be verified against this plan. Reload it before approving.</Text>
        <Button label="Reload assessment" variant="tinted" onPress={reload} />
      </>}
      {!plan.analysisRunId && <Text style={[styles.body, { color: theme.textSecondary }]}>No saved AI assessment is linked to this older or manually created plan.</Text>}
      {output && review.ready && <>
        <Group title="Situation understood by AI">
          <Text style={[styles.body, { color: theme.text }]}>{text(output.assessment.summary)}</Text>
          {captured && <Text style={[styles.small, { color: theme.textSecondary }]}>Assessment captured {new Date(captured.evaluatedAt).toLocaleString()}. These are saved observations, not a live situation feed.</Text>}
          {review.siblingCount > 0 && <Text style={[styles.small, { color: theme.textSecondary }]}>This assessment supports {review.siblingCount + 1} separate mobilizations. Approving this one does not approve the others.</Text>}
        </Group>
        {output.assessment.findings.map((finding) => <View key={finding.id} style={[styles.finding, { borderColor: theme.separator }]}>
          <Text style={[styles.heading, { color: theme.text }]}>{text(finding.risk)}</Text>
          {!!finding.possibleCause && <View style={styles.copy}>
            <Text style={[styles.small, { color: theme.textSecondary }]}>Possible cause, not confirmed</Text>
            <Text style={[styles.body, { color: theme.text }]}>{text(finding.possibleCause)}</Text>
          </View>}
          {!!finding.uncertainty && <View style={styles.copy}>
            <Text style={[styles.small, { color: theme.textSecondary }]}>Still uncertain</Text>
            <Text style={[styles.body, { color: theme.text }]}>{text(finding.uncertainty)}</Text>
          </View>}
          <DetailSection title="Supporting observations" summary="Read the facts behind this concern">
            {evidenceFor(finding.evidenceRefs).map((fact) => <Observation key={fact.ref} fact={fact} lookups={lookups} />)}
            {finding.evidenceRefs.some((ref) => !captured?.evidence.some((fact) => fact.ref === ref)) && <Text style={[styles.body, { color: theme.warning }]}>A supporting observation is unavailable. It must not be treated as confirmed.</Text>}
          </DetailSection>
        </View>)}

        <Group title="Why these team tasks">
          {plan.steps.map((step, index) => <View key={step.stepKey ?? index} style={styles.copy}>
            <Text style={[styles.heading, { color: theme.text }]}>{text(step.title ?? "Team task")}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{text(step.reason)}</Text>
            {!!step.evidenceRefs?.length && <DetailSection title="Observations behind this task" summary="Read the facts supporting this proposed action">
              {evidenceFor(step.evidenceRefs).map((fact) => <Observation key={fact.ref} fact={fact} lookups={lookups} />)}
            </DetailSection>}
          </View>)}
        </Group>

        {!!missing.length && <DetailSection title="Observations still needed" summary={`${missing.length} items need confirmation`}>
          {missing.map((item) => <Text key={item} style={[styles.body, { color: theme.text }]}>{item}</Text>)}
        </DetailSection>}

        <Group title="Response rules considered">
          <Text style={[styles.small, { color: theme.textSecondary }]}>A planned action is a proposed task, not completed work. Outstanding requirements include the other mobilizations from this assessment.</Text>
          {relevantReviews.map((item) => {
            const book = captured?.playbooks.find((book) => book.content.slug === item.slug && book.version === item.version);
            const actions = review.requiredActions.filter((action) => action.ref.slug === item.slug && action.ref.version === item.version);
            const outstanding = actions.filter((action) => action.unmet.length).length;
            const inputs = humanizeMissingInputs(item.missingInputs, lookups);
            return <DetailSection key={`${item.slug}:${item.version}`} title={text(titleFor(item.slug, item.version))}
              summary={`${outstanding} actions not fully covered · ${actions.length - outstanding} fully planned`}>
              <Text style={[styles.small, { color: theme.textSecondary }]}>Published version {item.version}</Text>
              <Text style={[styles.heading, { color: item.applicability === "insufficient_data" ? theme.warning : theme.text }]}>{item.applicability === "applicable" ? "Relevant to this situation" : item.applicability === "insufficient_data" ? "Relevant signs found; more observations needed" : "Referenced by this response plan"}</Text>
              <Text style={[styles.body, { color: theme.text }]}>{text(item.reason)}</Text>
              {book && <Group title="When this response applies"><Text style={[styles.body, { color: theme.text }]}>{text(book.content.appliesWhen)}</Text></Group>}
              {!!book?.content.constraints.length && <Group title="Rules every response must follow">{book.content.constraints.map((constraint) => <Text key={constraint.id} style={[styles.body, { color: theme.text }]}>{text(constraint.instruction)}</Text>)}</Group>}
              {!!inputs.length && <View style={styles.copy}><Text style={[styles.heading, { color: theme.text }]}>Confirm before applying the full response</Text>{inputs.map((input) => <Text key={input} style={[styles.body, { color: theme.textSecondary }]}>{input}</Text>)}</View>}
              {!!book?.content.decisionPoints.length && <Group title="Decisions reserved for Mo">{book.content.decisionPoints.map((decision) => <Text key={decision.id} style={[styles.body, { color: theme.text }]}>{text(decision.question)}</Text>)}</Group>}
              {actions.map((action) => <View key={action.ref.actionId} style={[styles.action, { borderColor: theme.separator }]}>
                <Text style={[styles.heading, { color: action.unmet.length ? theme.warning : theme.text }]}>{action.unmet.length ? "Not fully covered" : "Fully planned"}: {text(action.title)}</Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>{readableName("team", action.teamSlug, lookups)}</Text>
                <Text style={[styles.body, { color: theme.text }]}>{text(action.instructions)}</Text>
                {action.plannedBy.map((coverage, index) => <Text key={index} style={[styles.small, { color: theme.textSecondary }]}>{coverage.current ? "Planned in this mobilization, not yet completed" : `Planned in another mobilization: ${text(coverage.title)}. This approval does not approve that plan.`}</Text>)}
                {action.unmet.map((gap, index) => <View key={index} style={styles.copy}>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>{gap.current ? "Outstanding in this mobilization" : `Outstanding in another mobilization: ${text(gap.title)}`}</Text>
                  <Text style={[styles.body, { color: theme.text }]}>{text(gap.reason)}</Text>
                </View>)}
              </View>)}
              {!!book?.content.actions.some((action) => action.requirement === "recommended") && <Group title="Additional recommended actions">
                {book.content.actions.filter((action) => action.requirement === "recommended").map((action) => <View key={action.id} style={styles.copy}>
                  <Text style={[styles.heading, { color: theme.text }]}>{text(action.title)}</Text>
                  <Text style={[styles.small, { color: theme.textSecondary }]}>{readableName("team", action.teamSlug, lookups)}</Text>
                  <Text style={[styles.body, { color: theme.text }]}>{text(action.instructions)}</Text>
                </View>)}
              </Group>}
            </DetailSection>;
          })}
        </Group>

        {!!unusedReviews.length && <DetailSection title="Other playbooks checked" summary={`${unusedReviews.length} had no activation signal in the supplied observations`}>
          <Text style={[styles.small, { color: theme.textSecondary }]}>No activation signal does not prove that a risk is absent. These playbooks do not add decisions to this response.</Text>
          {unusedReviews.map((item) => <View key={`${item.slug}:${item.version}`} style={styles.copy}>
            <Text style={[styles.heading, { color: theme.text }]}>{text(titleFor(item.slug, item.version))}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{text(item.reason)}</Text>
          </View>)}
        </DetailSection>}
        {!!otherEvidence.length && <DetailSection title="Other captured context" summary="Venue, crew and other observations available during this assessment">
          {otherEvidence.map((fact) => <Observation key={fact.ref} fact={fact} lookups={lookups} />)}
        </DetailSection>}
      </>}
      {!plan.analysisRunId && plan.evidence && <Group title="Saved observations">
        <Text style={[styles.body, { color: theme.text }]}>{plan.evidence.weather.tempC}°C · temperature changing by {plan.evidence.weather.trendCPerHour}°C per hour</Text>
        {plan.evidence.incidents.map((incident, index) => <Text key={index} style={[styles.body, { color: theme.text }]}>{incident.count} {text(incident.category)} reports at {readableName("zone", incident.zoneSlug, lookups)}; {incident.openCount} still open.</Text>)}
      </Group>}
    </Sheet>
  );
}

function Observation({ fact, lookups }: { fact: PlanningEvidence; lookups: ReadableLookups }) {
  const theme = useTheme();
  const observation = describeEvidence(fact, lookups);
  return <View style={[styles.observation, { borderColor: theme.separator }]}>
    <Text style={[styles.heading, { color: theme.text }]}>{observation.title}</Text>
    {!!observation.location && <Text style={[styles.small, { color: theme.textSecondary }]}>{observation.location}</Text>}
    <Text style={[styles.small, { color: theme.textSecondary }]}>{observation.source} · {observation.observedAt}</Text>
    {observation.facts.map((line, index) => <Text key={index} style={[styles.body, { color: theme.text }]}>{line}</Text>)}
  </View>;
}

function DetailSection({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return <View style={[styles.section, { borderColor: theme.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={summary}
      accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen((value) => !value)}
      style={({ pressed }) => [styles.sectionHead, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.flex}><Text style={[styles.heading, { color: theme.text }]}>{title}</Text><Text style={[styles.small, { color: theme.textSecondary }]}>{summary}</Text></View>
      <Icon sf={open ? "chevron.up" : "chevron.down"} md={open ? "expand_less" : "expand_more"} size={16} color={theme.textSecondary} />
    </Pressable>
    {open && <View style={[styles.sectionBody, { borderColor: theme.separator }]}>{children}</View>}
  </View>;
}

const styles = StyleSheet.create({
  body: { fontSize: Type.body, lineHeight: 23 },
  small: { fontSize: Type.footnote, lineHeight: 19 },
  heading: { fontSize: Type.body, fontWeight: "600", lineHeight: 22 },
  copy: { gap: 5 },
  finding: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  section: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  sectionHead: { flexDirection: "row", alignItems: "center", minHeight: 60, padding: 14, gap: 12 },
  sectionBody: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 14 },
  observation: { paddingBottom: 14, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth },
  action: { paddingTop: 14, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 4 },
});
