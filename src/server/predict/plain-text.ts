import type { MobilizationOutput, PlanningSnapshot } from "@/lib/mobilization-contracts";
import { TIME_ZONE } from "@/lib/roster";

/**
 * What Mo and volunteers read is plain words: no evidence refs, ids, "Sources: …", raw JSON or ISO times. The prompt
 * asks for that; this makes sure, on the plan's titles, instructions, reasons, completion criteria and rationale.
 * Evidence stays in evidenceRefs, untouched.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const SOURCE_WORD = String.raw`\b(?:sources?|refs?|evidence ?refs?|evidenceRefs|citations?)\s*:`;
const SOURCES_BRACKETED = new RegExp(String.raw`[([]\s*${SOURCE_WORD}[^)\]]*[)\]]`, "gi");
const SOURCES = new RegExp(`${SOURCE_WORD}[^.;\n]*`, "gi");
const JSON_OBJECT = /\{[^{}]*"[^"]*"\s*:[^{}]*\}/g;
const JSON_ARRAY = /\[\s*"[^\]]*\]/g;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clock = new Intl.DateTimeFormat("en-AU", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

/** Cleans one line of text against the snapshot's evidence refs and zones. */
export function plainTextFor(snapshot: Pick<PlanningSnapshot, "evidence" | "zones">) {
  const refs = [...new Set(snapshot.evidence.map((entry) => entry.ref))].sort((a, b) => b.length - a.length);
  const refPattern = refs.length ? new RegExp(`(?<![\\w-])(?:${refs.map(escape).join("|")})(?![\\w-])`, "g") : null;
  // Only hyphenated slugs: "backstage" or "bar" are also ordinary words.
  const zones = snapshot.zones.filter((zone) => zone.slug.includes("-") && zone.name.trim())
    .sort((a, b) => b.slug.length - a.slug.length);
  return (text: string): string => {
    let out = text
      .replace(SOURCES_BRACKETED, "")
      .replace(SOURCES, "")
      .replace(JSON_OBJECT, "")
      .replace(JSON_ARRAY, "")
      .replace(ISO, (match) => {
        const at = Date.parse(match);
        return Number.isFinite(at) ? clock.format(at) : "";
      });
    if (refPattern) out = out.replace(refPattern, "");
    out = out.replace(UUID, "");
    for (const zone of zones)
      out = out.replace(new RegExp(`(?<![\\w-])${escape(zone.slug)}(?![\\w-])`, "g"), zone.name);
    return out
      .replace(/\(\s*[,;:]*\s*\)|\[\s*[,;:]*\s*\]/g, "")
      .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
      .replace(/[ \t]+([,;:.])/g, "$1")
      .replace(/[,;:]+(?=\s*(?:[.)]|$))/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  };
}

/** The plan with every line people read made plain. Empty after cleaning falls back to the next best line. */
export function plainPlan(output: MobilizationOutput, snapshot: Pick<PlanningSnapshot, "evidence" | "zones">):
  MobilizationOutput {
  const plain = plainTextFor(snapshot);
  const pick = (...lines: string[]) => lines.map(plain).find(Boolean) ?? "See Mo";
  return {
    ...output,
    mobilizations: output.mobilizations.map((plan) => ({
      ...plan,
      title: pick(plan.title, "Response plan"),
      rationale: pick(plan.rationale, output.assessment.summary, plan.title),
      tasks: plan.tasks.map((task) => {
        const title = pick(task.title, task.reason);
        return {
          ...task, title,
          instructions: pick(task.instructions, title),
          reason: pick(task.reason, title),
          completionCriteria: pick(task.completionCriteria, title),
        };
      }),
    })),
  };
}
