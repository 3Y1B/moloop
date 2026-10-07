import { PlaybookContentSchema, type ManagedPlaybook } from "@/lib/mobilization-contracts";
import { FESTIVAL_PLAYBOOKS } from "./festival";

const at = new Date().toISOString();

/** The planner's playbooks: fixed in code (./festival.ts), so there are no drafts or versions to manage. */
export const playbooks = (): ManagedPlaybook[] => FESTIVAL_PLAYBOOKS.map((book) => {
  const content = PlaybookContentSchema.parse(book);
  return { id: content.slug, version: 1, status: "published", content, createdAt: at, updatedAt: at, publishedAt: at };
});
