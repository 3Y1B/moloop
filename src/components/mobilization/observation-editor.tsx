import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { SimulationContext } from "@/lib/mobilization-contracts";
import {
  OBSERVATION_DEFINITIONS,
  ObservationSchema,
  observationDefinition,
  observationReferenceErrors,
  type MobilizationObservation,
  type ObservationDefinition,
} from "@/lib/mobilization-observations";
import { PlanningChoice as Choice, PlanningField as Field } from "./planning-form";

type BaseDraft = { id: string; key: string; zoneSlug: string; minutesAgo: string };
type CountDraft = { zoneSlug: string; count: string };
type LocationDraft = {
  zoneSlug: string;
  status: string | null;
  capacity: string;
  approved: boolean | null;
};
type RouteDraft = {
  fromZoneSlug: string;
  toZoneSlug: string;
  status: "open" | "restricted" | "closed" | null;
  approved: boolean | null;
};
export type ObservationDraft = BaseDraft &
  (
    | { kind: "number"; value: string }
    | { kind: "boolean"; value: boolean | null }
    | { kind: "status"; value: string | null }
    | { kind: "text"; value: string }
    | { kind: "location"; value: string | null }
    | {
        kind: "zone_counts";
        value: { coverage: "partial" | "all_venue" | null; entries: CountDraft[] };
      }
    | { kind: "locations"; value: LocationDraft[] }
    | { kind: "routes"; value: RouteDraft[] }
  );
const GROUPS: { value: ObservationDefinition["group"]; label: string }[] = [
  { value: "weather", label: "Weather" },
  { value: "crowd", label: "Crowd" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "medical", label: "Medical" },
  { value: "approvals", label: "Approvals" },
];
const YES_NO = [
  { value: "", label: "Unknown" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const boolValue = (value: boolean | null) => (value == null ? "" : value ? "yes" : "no");
const parseBool = (value: string) => (value === "" ? null : value === "yes");
const id = () => `observation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function newDraft(definition: ObservationDefinition): ObservationDraft {
  const base = { id: id(), key: definition.key, zoneSlug: "", minutesAgo: "" };
  switch (definition.kind) {
    case "number":
      return { ...base, kind: "number", value: "" };
    case "boolean":
      return { ...base, kind: "boolean", value: null };
    case "status":
      return { ...base, kind: "status", value: null };
    case "text":
      return { ...base, kind: "text", value: "" };
    case "location":
      return { ...base, kind: "location", value: null };
    case "zone_counts":
      return { ...base, kind: "zone_counts", value: { coverage: null, entries: [] } };
    case "locations":
      return { ...base, kind: "locations", value: [] };
    case "routes":
      return { ...base, kind: "routes", value: [] };
  }
}
function numeric(value: string, label: string): number {
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error(`Enter a number for ${label}.`);
  return Number(value);
}

/** Empty observations remain unknown. Only explicit values with a time become scenario evidence. */
export function buildObservationInputs(
  drafts: readonly ObservationDraft[],
  zones: SimulationContext["zones"],
): MobilizationObservation[] {
  const rows: MobilizationObservation[] = [];
  for (const draft of drafts) {
    let value: unknown;
    switch (draft.kind) {
      case "number":
        if (!draft.value.trim()) continue;
        value = numeric(draft.value, draft.key);
        break;
      case "boolean":
        if (draft.value == null) continue;
        value = draft.value;
        break;
      case "status":
      case "location":
        if (!draft.value) continue;
        value = draft.value;
        break;
      case "text":
        if (!draft.value.trim()) continue;
        value = draft.value;
        break;
      case "zone_counts": {
        const entries = draft.value.entries.filter((entry) => entry.zoneSlug || entry.count.trim());
        if (!entries.length) continue;
        if (!draft.value.coverage)
          throw new Error(`${draft.key}: choose partial or all-venue coverage.`);
        value = {
          coverage: draft.value.coverage,
          entries: entries.map((entry) => ({
            zoneSlug: entry.zoneSlug,
            count: numeric(entry.count, `${draft.key} count`),
          })),
        };
        break;
      }
      case "locations": {
        const entries = draft.value.filter(
          (entry) =>
            entry.zoneSlug || entry.status || entry.capacity.trim() || entry.approved != null,
        );
        if (!entries.length) continue;
        value = entries.map((entry, index) => {
          if (!entry.zoneSlug || !entry.status || entry.approved == null)
            throw new Error(
              `${draft.key}, location ${index + 1}: choose a location, status and explicit approval.`,
            );
          return {
            zoneSlug: entry.zoneSlug,
            status: entry.status,
            capacity: entry.capacity.trim()
              ? numeric(entry.capacity, `${draft.key} capacity`)
              : null,
            approved: entry.approved,
          };
        });
        break;
      }
      case "routes": {
        const entries = draft.value.filter(
          (entry) =>
            entry.fromZoneSlug || entry.toZoneSlug || entry.status || entry.approved != null,
        );
        if (!entries.length) continue;
        value = entries.map((entry, index) => {
          if (!entry.fromZoneSlug || !entry.toZoneSlug || !entry.status || entry.approved == null)
            throw new Error(
              `${draft.key}, route ${index + 1}: choose both endpoints, status and explicit approval.`,
            );
          return { ...entry, status: entry.status, approved: entry.approved };
        });
        break;
      }
    }
    const parsed = ObservationSchema.safeParse({
      key: draft.key,
      kind: draft.kind,
      zoneSlug: draft.zoneSlug || null,
      minutesAgo: numeric(draft.minutesAgo, `${draft.key} minutes ago`),
      value,
    });
    if (!parsed.success)
      throw new Error(
        `${draft.key}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      );
    rows.push(parsed.data);
  }
  const errors = observationReferenceErrors(
    rows,
    zones.map((zone) => zone.slug),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return rows;
}

export function ObservationEditor({
  context,
  value,
  onChange,
  disabled,
}: {
  context: SimulationContext;
  value: ObservationDraft[];
  onChange: (value: ObservationDraft[]) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  const [group, setGroup] = useState<ObservationDefinition["group"]>("weather");
  const zoneChoices = context.zones.map((zone) => ({ value: zone.slug, label: zone.name }));
  const replace = (draft: ObservationDraft) =>
    onChange(value.map((item) => (item.id === draft.id ? draft : item)));
  const requiredKeys = new Set(
    context.playbooks
      .filter((playbook) => playbook.status === "published")
      .flatMap((playbook) => playbook.content.requiredInputs),
  );
  const definitions = OBSERVATION_DEFINITIONS.filter(
    (definition) => !definition.builtin && definition.group === group,
  ).sort(
    (a, b) =>
      Number(requiredKeys.has(b.key)) - Number(requiredKeys.has(a.key)) ||
      a.label.localeCompare(b.label),
  );

  return (
    <View style={styles.field}>
      <Text style={[styles.small, { color: theme.textSecondary }]}>
        Hypothetical test observations. Blank values stay unknown; approvals are choices for this
        scenario.
      </Text>
          {value.map((draft) => {
            const definition = observationDefinition(draft.key);
            if (!definition) return null;
            const scopeChoices = zoneChoices.filter(
              (zone) =>
                !value.some(
                  (item) =>
                    item.id !== draft.id && item.key === draft.key && item.zoneSlug === zone.value,
                ),
            );
            const measured =
              draft.kind === "number" ||
              draft.kind === "boolean" ||
              draft.kind === "status" ||
              draft.kind === "text";
            return (
              <Card key={draft.id} style={styles.card}>
                <Text style={[styles.title, { color: theme.text }]}>{definition.label}</Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  {draft.key} · Hypothetical
                </Text>
                {measured && definition.scope !== "site" && (
                  <Choice
                    label={
                      definition.scope === "zone"
                        ? "Observation location"
                        : "Observation location (optional)"
                    }
                    value={draft.zoneSlug}
                    choices={
                      definition.scope === "zone"
                        ? scopeChoices
                        : [{ value: "", label: "Not specified" }, ...scopeChoices]
                    }
                    disabled={disabled}
                    onChange={(zoneSlug) => replace({ ...draft, zoneSlug })}
                  />
                )}
                {definition.scope === "site" && (
                  <Text style={[styles.small, { color: theme.textSecondary }]}>
                    Site-wide observation
                  </Text>
                )}
                <Field
                  label="Observed (minutes ago)"
                  value={draft.minutesAgo}
                  numeric
                  disabled={disabled}
                  hint="0 means now. A known observation needs a time, up to 1440 minutes ago."
                  onChange={(minutesAgo) => replace({ ...draft, minutesAgo })}
                />

                {draft.kind === "number" && (
                  <Field
                    label={definition.unit ? `Value (${definition.unit})` : "Value"}
                    value={draft.value}
                    numeric
                    disabled={disabled}
                    hint={`Leave blank if unknown.${definition.min != null && definition.max != null ? ` Range: ${definition.min} to ${definition.max}${definition.unit ? ` ${definition.unit}` : ""}.` : ""}${definition.integer ? " Whole numbers only." : ""}`}
                    onChange={(next) => replace({ ...draft, value: next })}
                  />
                )}
                {draft.kind === "boolean" && (
                  <Choice
                    label="Observed condition"
                    value={boolValue(draft.value)}
                    choices={YES_NO}
                    disabled={disabled}
                    onChange={(next) => replace({ ...draft, value: parseBool(next) })}
                  />
                )}
                {draft.kind === "status" && (
                  <Choice
                    label="Observed status"
                    value={draft.value ?? ""}
                    choices={[
                      { value: "", label: "Unknown" },
                      ...(definition.options ?? []).map((option) => ({
                        value: option,
                        label: option.replaceAll("_", " "),
                      })),
                    ]}
                    disabled={disabled}
                    onChange={(next) => replace({ ...draft, value: next || null })}
                  />
                )}
                {draft.kind === "text" && (
                  <Field
                    label="Observed details"
                    value={draft.value}
                    multiline
                    disabled={disabled}
                    hint="Describe the observation or source. Leave blank if unknown."
                    onChange={(next) => replace({ ...draft, value: next })}
                  />
                )}
                {draft.kind === "location" && (
                  <Choice
                    label="Reported location"
                    value={draft.value ?? ""}
                    choices={[{ value: "", label: "Unknown" }, ...zoneChoices]}
                    disabled={disabled}
                    onChange={(next) => replace({ ...draft, value: next || null })}
                  />
                )}

                {draft.kind === "zone_counts" && (
                  <>
                    <Choice
                      label="Count coverage"
                      value={draft.value.coverage ?? ""}
                      choices={[
                        { value: "", label: "Unknown" },
                        { value: "partial", label: "Selected zones" },
                        { value: "all_venue", label: "All venue zones" },
                      ]}
                      disabled={disabled}
                      onChange={(next) =>
                        replace({
                          ...draft,
                          value: {
                            ...draft.value,
                            coverage: next ? (next as "partial" | "all_venue") : null,
                          },
                        })
                      }
                    />
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      All-venue coverage requires an explicit count for every venue zone. Expected
                      stage attendance is a different observation.
                    </Text>
                    {draft.value.entries.map((entry, index) => (
                      <View key={index} style={styles.entry}>
                        <Choice
                          label={`Count ${index + 1} zone`}
                          value={entry.zoneSlug}
                          choices={zoneChoices.filter(
                            (zone) =>
                              !draft.value.entries.some(
                                (item, itemIndex) =>
                                  itemIndex !== index && item.zoneSlug === zone.value,
                              ),
                          )}
                          disabled={disabled}
                          onChange={(zoneSlug) =>
                            replace({
                              ...draft,
                              value: {
                                ...draft.value,
                                entries: draft.value.entries.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, zoneSlug } : item,
                                ),
                              },
                            })
                          }
                        />
                        <Field
                          label={definition.unit ? `Count (${definition.unit})` : "Count"}
                          value={entry.count}
                          numeric
                          disabled={disabled}
                          hint="Whole count, 0 to 100000. 0 is an explicit zero count; blank is unknown."
                          onChange={(count) =>
                            replace({
                              ...draft,
                              value: {
                                ...draft.value,
                                entries: draft.value.entries.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, count } : item,
                                ),
                              },
                            })
                          }
                        />
                        <Button
                          label="Remove zone count"
                          variant="plain"
                          color={theme.danger}
                          size="large"
                          disabled={disabled}
                          onPress={() =>
                            replace({
                              ...draft,
                              value: {
                                ...draft.value,
                                entries: draft.value.entries.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              },
                            })
                          }
                        />
                      </View>
                    ))}
                    <Button
                      label="Add zone count"
                      sf="plus"
                      variant="tinted"
                      size="large"
                      disabled={disabled || draft.value.entries.length >= context.zones.length}
                      onPress={() =>
                        replace({
                          ...draft,
                          value: {
                            ...draft.value,
                            entries: [...draft.value.entries, { zoneSlug: "", count: "" }],
                          },
                        })
                      }
                    />
                    <Button
                      label="Add every venue zone"
                      variant="plain"
                      size="large"
                      disabled={disabled}
                      onPress={() =>
                        replace({
                          ...draft,
                          value: {
                            ...draft.value,
                            entries: context.zones.map(
                              (zone) =>
                                draft.value.entries.find(
                                  (entry) => entry.zoneSlug === zone.slug,
                                ) ?? { zoneSlug: zone.slug, count: "" },
                            ),
                          },
                        })
                      }
                    />
                  </>
                )}

                {draft.kind === "locations" && (
                  <>
                    {draft.value.map((entry, index) => {
                      const update = (next: LocationDraft) =>
                        replace({
                          ...draft,
                          value: draft.value.map((item, itemIndex) =>
                            itemIndex === index ? next : item,
                          ),
                        });
                      const recordedCapacity = context.zones.find(
                        (zone) => zone.slug === entry.zoneSlug,
                      )?.capacity;
                      return (
                        <View key={index} style={styles.entry}>
                          <Choice
                            label={`Area ${index + 1}`}
                            value={entry.zoneSlug}
                            choices={zoneChoices.filter(
                              (zone) =>
                                !draft.value.some(
                                  (item, itemIndex) =>
                                    itemIndex !== index && item.zoneSlug === zone.value,
                                ),
                            )}
                            disabled={disabled}
                            onChange={(zoneSlug) => update({ ...entry, zoneSlug })}
                          />
                          <Choice
                            label="Area status"
                            value={entry.status ?? ""}
                            choices={[
                              { value: "", label: "Unknown" },
                              ...(definition.options ?? []).map((option) => ({
                                value: option,
                                label: option.replaceAll("_", " "),
                              })),
                            ]}
                            disabled={disabled}
                            onChange={(status) => update({ ...entry, status: status || null })}
                          />
                          <Field
                            label="Capacity (people)"
                            value={entry.capacity}
                            numeric
                            disabled={disabled}
                            hint={
                              recordedCapacity != null
                                ? `Recorded zone capacity: ${recordedCapacity}. Scenario capacity is 0 to 100000 people; leave blank if unknown.`
                                : "Whole count, 0 to 100000 people. Leave blank if capacity is unknown."
                            }
                            onChange={(capacity) => update({ ...entry, capacity })}
                          />
                          <Choice
                            label="Approved for this scenario?"
                            value={boolValue(entry.approved)}
                            choices={YES_NO}
                            disabled={disabled}
                            onChange={(approved) =>
                              update({ ...entry, approved: parseBool(approved) })
                            }
                          />
                          <Button
                            label="Remove area"
                            variant="plain"
                            color={theme.danger}
                            size="large"
                            disabled={disabled}
                            onPress={() =>
                              replace({
                                ...draft,
                                value: draft.value.filter((_, itemIndex) => itemIndex !== index),
                              })
                            }
                          />
                        </View>
                      );
                    })}
                    <Button
                      label="Add area"
                      sf="plus"
                      variant="tinted"
                      size="large"
                      disabled={disabled || draft.value.length >= context.zones.length}
                      onPress={() =>
                        replace({
                          ...draft,
                          value: [
                            ...draft.value,
                            { zoneSlug: "", status: null, capacity: "", approved: null },
                          ],
                        })
                      }
                    />
                  </>
                )}

                {draft.kind === "routes" && (
                  <>
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      A walking connection does not establish route approval. Choose the route
                      status and approval explicitly for this test. Approval applies only in the
                      selected From → To direction.
                    </Text>
                    {draft.value.map((entry, index) => {
                      const update = (next: RouteDraft) =>
                        replace({
                          ...draft,
                          value: draft.value.map((item, itemIndex) =>
                            itemIndex === index ? next : item,
                          ),
                        });
                      return (
                        <View key={index} style={styles.entry}>
                          <Choice
                            label={`Route ${index + 1} from`}
                            value={entry.fromZoneSlug}
                            choices={zoneChoices.filter((zone) => zone.value !== entry.toZoneSlug)}
                            disabled={disabled}
                            onChange={(fromZoneSlug) => update({ ...entry, fromZoneSlug })}
                          />
                          <Choice
                            label="Route to"
                            value={entry.toZoneSlug}
                            choices={zoneChoices.filter(
                              (zone) => zone.value !== entry.fromZoneSlug,
                            )}
                            disabled={disabled}
                            onChange={(toZoneSlug) => update({ ...entry, toZoneSlug })}
                          />
                          <Choice
                            label="Route status"
                            value={entry.status ?? ""}
                            choices={[
                              { value: "", label: "Unknown" },
                              { value: "open", label: "Open" },
                              { value: "restricted", label: "Restricted" },
                              { value: "closed", label: "Closed" },
                            ]}
                            disabled={disabled}
                            onChange={(status) =>
                              update({
                                ...entry,
                                status: status ? (status as RouteDraft["status"]) : null,
                              })
                            }
                          />
                          <Choice
                            label="Approved for this scenario?"
                            value={boolValue(entry.approved)}
                            choices={YES_NO}
                            disabled={disabled}
                            onChange={(approved) =>
                              update({ ...entry, approved: parseBool(approved) })
                            }
                          />
                          <Button
                            label="Remove route"
                            variant="plain"
                            color={theme.danger}
                            size="large"
                            disabled={disabled}
                            onPress={() =>
                              replace({
                                ...draft,
                                value: draft.value.filter((_, itemIndex) => itemIndex !== index),
                              })
                            }
                          />
                        </View>
                      );
                    })}
                    <Button
                      label="Add route"
                      sf="plus"
                      variant="tinted"
                      size="large"
                      disabled={disabled || draft.value.length >= 100}
                      onPress={() =>
                        replace({
                          ...draft,
                          value: [
                            ...draft.value,
                            { fromZoneSlug: "", toZoneSlug: "", status: null, approved: null },
                          ],
                        })
                      }
                    />
                  </>
                )}
                <Button
                  label="Remove observation"
                  variant="plain"
                  color={theme.danger}
                  size="large"
                  disabled={disabled}
                  onPress={() => onChange(value.filter((item) => item.id !== draft.id))}
                />
              </Card>
            );
          })}
          <Button
            label={showPicker ? "Close input picker" : "Add an observation"}
            sf="plus"
            variant="tinted"
            size="large"
            disabled={disabled || (!showPicker && value.length >= 100)}
            onPress={() => setShowPicker((show) => !show)}
          />
          {showPicker && (
            <Card style={styles.card}>
              <Choice
                label="Input group"
                value={group}
                choices={GROUPS}
                disabled={disabled}
                onChange={(next) => setGroup(next as ObservationDefinition["group"])}
              />
              {definitions.map((definition) => {
                const added = value.some((draft) => draft.key === definition.key);
                const canRepeat = definition.scope === "zone";
                return (
                  <View key={definition.key} style={styles.field}>
                    <Button
                      label={`${definition.label}${added ? (canRepeat ? " (another zone)" : " (added)") : ""}`}
                      variant="tinted"
                      size="large"
                      disabled={disabled || (added && !canRepeat)}
                      onPress={() => {
                        onChange([...value, newDraft(definition)]);
                        setShowPicker(false);
                      }}
                    />
                    <Text style={[styles.small, { color: theme.textSecondary }]}>
                      {definition.key}
                      {requiredKeys.has(definition.key) ? " · Required by a published SOP" : ""}
                      {definition.unit ? ` · ${definition.unit}` : ""}
                    </Text>
                  </View>
                );
              })}
            </Card>
          )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { fontSize: Type.body, fontWeight: "600" },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  field: { gap: 7 },
  entry: { gap: 14, paddingTop: 12, paddingBottom: 4 },
});
