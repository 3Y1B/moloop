import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";

import { openTaskSheet } from "@/components/lead/open-sheet";
import { Sheet, SheetTitle } from "@/components/lead/sheet";
import { Group } from "@/components/lead/group";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, Separator } from "@/components/ui/card";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { Mobilization, MobilizationStep, Proposal, Team, Volunteer } from "@/lib/schema";
import type { MobilizationStepStatus } from "@/lib/status";
import { goBack } from "@/lib/navigation";
import type { approvalCrewPreview } from "./approval-review";
import { crewReplyLabel, operationalDetails, taskForStep, taskProgressLabel } from "./presentation";
import { readableName, readableText, type ReadableLookups } from "./readable-analysis";

export function MobilizationTaskDetails({ plan, step, status, tasks, preview, volunteers, teams, lookups, proposals }: {
  plan: Mobilization; step: MobilizationStep; status?: MobilizationStepStatus;
  tasks: Parameters<typeof taskForStep>[2];
  preview?: ReturnType<typeof approvalCrewPreview>["steps"][number];
  volunteers: Record<string, Volunteer>; teams: Record<string, Team>;
  lookups: ReadableLookups; proposals: Record<string, Proposal>;
}) {
  const theme = useTheme();
  const task = taskForStep(plan, step, tasks);
  const detail = operationalDetails(plan, step, task);
  const text = (value: string) => readableText(value, lookups);
  const teamName = readableName("team", detail.teamSlug, lookups);
  const pending = plan.status === "proposed";
  const crew = task ? [
    ...(task.assigneeId ? [{ id: task.assigneeId, label: crewReplyLabel(task,
      !["assigned", "queued", "open"].includes(task.status), true) }] : []),
    ...task.helpers.map((helper) => ({ id: helper.volunteerId, label: crewReplyLabel(task, helper.status === "accepted") })),
  ] : [];
  return (
    <Sheet>
      <Button label="Back to mobilization" variant="plain" onPress={() => goBack({ pathname: "/mobilize/[id]", params: { id: plan.id } })} />
      <SheetTitle title={text(detail.title)} />
      <Text style={[styles.small, { color: theme.textSecondary }]}>{teamName} · {detail.peopleNeeded} {detail.peopleNeeded === 1 ? "person" : "people"} required</Text>
      {pending && <Text style={[styles.small, { color: theme.textSecondary }]}>Proposed task. No one is assigned until Mo approves the mobilization.</Text>}
      <Group title="Location">
        <Text style={[styles.body, { color: theme.text }]}>{detail.zoneSlug ? readableName("zone", detail.zoneSlug, lookups) : "Whole event"}</Text>
      </Group>
      <Group title="What to do">
        <Text style={[styles.body, { color: theme.text }]}>{detail.instructions ? text(detail.instructions) : "No detailed instructions were saved for this task."}</Text>
      </Group>
      <Group title="Done when">
        <Text style={[styles.body, { color: theme.text }]}>{detail.completionCriteria ? text(detail.completionCriteria) : "No completion condition was saved for this task."}</Text>
      </Group>
      {!!detail.requiredSkills.length && <Group title="Required qualifications">
        {detail.requiredSkills.map((skill) => <Text key={skill} style={[styles.body, { color: theme.text }]}>{readableName("skill", skill, lookups)}</Text>)}
      </Group>}
      <Group title="People">
        {pending ? <>
          <Text style={[styles.body, { color: theme.text }]}>{preview?.eligible ?? 0} eligible {preview?.eligible === 1 ? "candidate" : "candidates"} in this preview · {detail.peopleNeeded} required.</Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>Candidates are not assigned yet. Approval checks available crew again; this preview is not a complete list of available people.</Text>
          {!!preview?.gap && <Text style={[styles.body, { color: theme.warning }]}>{preview.gap} {preview.gap === 1 ? "place is" : "places are"} not covered by the candidate preview.</Text>}
        </> : <>
          <Text style={[styles.body, { color: theme.text }]}>{taskProgressLabel(plan, task, status)}</Text>
          {!!crew.length && <Card>{crew.map((person, index) => <Fragment key={person.id}>
            {index > 0 && <Separator inset={58} />}
            <View style={styles.person}>
              <Avatar name={volunteers[person.id]?.name ?? "Crew member"} color={teams[step.teamSlug]?.color} size={30} />
              <View style={styles.flex}>
                <Text style={[styles.body, { color: theme.text }]}>{text(volunteers[person.id]?.name ?? "Crew member")}</Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>{person.label}</Text>
              </View>
            </View>
          </Fragment>)}</Card>}
        </>}
      </Group>
      {task && <Button label="Open task" variant="tinted" size="large" onPress={() => openTaskSheet(task, proposals)} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: Type.body, lineHeight: 23 },
  small: { fontSize: Type.footnote, lineHeight: 19 },
  person: { flexDirection: "row", gap: 12, alignItems: "center", padding: 14, minHeight: 58 },
  flex: { flex: 1, gap: 2 },
});
