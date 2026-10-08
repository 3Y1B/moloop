import type { Sql, TransactionSql } from "postgres";

import { CommandError } from "@/lib/batch";
import {
  PlaybookContentSchema,
  type ManagedPlaybook,
  type PlaybookContent,
  type SavePlaybookDraftInput,
} from "@/lib/mobilization-contracts";
import { sql } from "../world";

type Query = Sql | TransactionSql;
/** A transaction seam lets integration checks roll back published history instead of deleting it. */
export type PlaybookDatabase = {
  query: () => Query;
  transaction: <T>(work: (q: TransactionSql) => Promise<T>) => Promise<T>;
};
type Row = {
  id: string;
  slug: string;
  version: number;
  status: ManagedPlaybook["status"];
  content: PlaybookContent;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

const MO_ROLES = new Set(["coordinator", "safety_lead", "admin"]);

/** Preserve PostgreSQL's microseconds: updatedAt is an opaque optimistic concurrency token. */
function timestamp(value: string): string {
  return value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/\+00:00$/, "Z");
}

function toManaged(row: Row): ManagedPlaybook {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    content: PlaybookContentSchema.parse(row.content),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    publishedAt: row.published_at == null ? null : timestamp(row.published_at),
  };
}

async function requireMo(q: Query, actorId: string) {
  const [actor] = await q<{ role: string }[]>`select role from profiles where id = ${actorId}`;
  if (!actor || !MO_ROLES.has(actor.role))
    throw new CommandError("forbidden", "Only Mo can manage playbooks");
}

async function rowOf(q: Query, id: string, lock = false): Promise<Row> {
  const rows = lock
    ? await q<Row[]>`select * from playbook_versions where id = ${id} for update`
    : await q<Row[]>`select * from playbook_versions where id = ${id}`;
  if (!rows[0]) throw new CommandError("not_found", `No playbook version ${id}`);
  return rows[0];
}

/** Serialise allocation and publication for one SOP; unrelated playbooks remain independent. */
async function lockSlug(q: TransactionSql, slug: string) {
  await q`select pg_advisory_xact_lock(hashtextextended(${slug}, 73190))`;
}

function checkExpected(row: Row, expectedUpdatedAt: string | null) {
  if (expectedUpdatedAt == null)
    throw new CommandError("invalid", "An existing draft needs expectedUpdatedAt");
  if (timestamp(row.updated_at) !== expectedUpdatedAt)
    throw new CommandError("conflict", "This playbook changed. Reload it before saving.");
}

function uniqueIds(items: { id: string }[], label: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new CommandError("invalid", `${label} IDs must be unique within a playbook`);
}

/** A published SOP may reference only the roster's real team and skill vocabulary. */
async function validateReferences(q: Query, content: PlaybookContent) {
  uniqueIds(content.actions, "Action");
  uniqueIds(content.constraints, "Constraint");
  uniqueIds(content.decisionPoints, "Decision point");
  if (new Set(content.requiredInputs).size !== content.requiredInputs.length)
    throw new CommandError("invalid", "Required inputs must not contain duplicates");
  for (const action of content.actions) {
    if (new Set(action.requiredSkills).size !== action.requiredSkills.length)
      throw new CommandError("invalid", `Action ${action.id} repeats a required skill`);
  }

  const teamSlugs = [...new Set(content.actions.map((action) => action.teamSlug))];
  const skillSlugs = [...new Set(content.actions.flatMap((action) => action.requiredSkills))];
  const [teams, skills] = await Promise.all([
    q<{ slug: string }[]>`select slug from teams where slug = any(${teamSlugs}::text[])`,
    q<{ slug: string }[]>`select slug from skills where slug = any(${skillSlugs}::text[])`,
  ]);
  const knownTeams = new Set(teams.map((team) => team.slug));
  const knownSkills = new Set(skills.map((skill) => skill.slug));
  const missingTeams = teamSlugs.filter((slug) => !knownTeams.has(slug));
  const missingSkills = skillSlugs.filter((slug) => !knownSkills.has(slug));
  if (missingTeams.length)
    throw new CommandError("invalid", `Unknown teams: ${missingTeams.join(", ")}`);
  if (missingSkills.length)
    throw new CommandError("invalid", `Unknown skills: ${missingSkills.join(", ")}`);
}

async function insertDraft(
  q: TransactionSql,
  actorId: string,
  content: PlaybookContent,
): Promise<ManagedPlaybook> {
  const [version] = await q<{ next: number }[]>`
    select coalesce(max(version), 0) + 1 as next from playbook_versions where slug = ${content.slug}`;
  const [created] = await q<Row[]>`
    insert into playbook_versions (slug, version, status, content, created_by)
    values (${content.slug}, ${version.next}, 'draft', ${q.json(content)}, ${actorId}) returning *`;
  return toManaged(created);
}

/** Human-owned SOP versions. Published bodies are immutable; changes are drafted as a new version. */
export class PlaybookStore {
  constructor(
    private readonly database: PlaybookDatabase = {
      query: sql,
      transaction: <T>(work: (q: TransactionSql) => Promise<T>) => sql().begin(work) as Promise<T>,
    },
  ) {}

  private async asMo<T>(actorId: string, work: (q: TransactionSql) => Promise<T>): Promise<T> {
    return this.database.transaction(async (q) => {
      await requireMo(q, actorId);
      return work(q);
    });
  }

  async list(actorId: string): Promise<ManagedPlaybook[]> {
    return this.asMo(actorId, async (q) => {
      const rows = await q<Row[]>`
        select * from playbook_versions order by slug, version desc`;
      return rows.map(toManaged);
    });
  }

  async saveDraft(actorId: string, input: SavePlaybookDraftInput): Promise<ManagedPlaybook> {
    const parsed = PlaybookContentSchema.safeParse(input.content);
    if (!parsed.success) throw new CommandError("invalid", "Invalid playbook content");
    const content = parsed.data;
    if (input.id == null && input.expectedUpdatedAt != null)
      throw new CommandError("invalid", "A new draft must not include expectedUpdatedAt");
    return this.asMo(actorId, async (q) => {
      if (input.id == null) {
        await lockSlug(q, content.slug);
        await validateReferences(q, content);
        return insertDraft(q, actorId, content);
      }
      const before = await rowOf(q, input.id, true);
      checkExpected(before, input.expectedUpdatedAt);
      if (before.status !== "draft")
        throw new CommandError("conflict", "Published playbooks need a new draft revision");
      if (content.slug !== before.slug)
        throw new CommandError("invalid", "Create a new playbook to change its slug");
      await validateReferences(q, content);
      const [saved] = await q<Row[]>`
        update playbook_versions set content = ${q.json(content)},
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
        where id = ${before.id} returning *`;
      return toManaged(saved);
    });
  }

  async revise(actorId: string, id: string): Promise<ManagedPlaybook> {
    return this.asMo(actorId, async (q) => {
      const source = await rowOf(q, id);
      await lockSlug(q, source.slug);
      const before = await rowOf(q, id, true);
      if (before.status === "draft")
        throw new CommandError("conflict", "This version is already an editable draft");
      // Keep the exact human-provided body; saving the new draft is where edits and reference checks happen.
      return insertDraft(q, actorId, PlaybookContentSchema.parse(before.content));
    });
  }

  async publish(actorId: string, id: string, expectedUpdatedAt: string): Promise<ManagedPlaybook> {
    return this.asMo(actorId, async (q) => {
      const candidate = await rowOf(q, id);
      await lockSlug(q, candidate.slug);
      const before = await rowOf(q, id, true);
      checkExpected(before, expectedUpdatedAt);
      if (before.status !== "draft")
        throw new CommandError("conflict", "Only a draft can be published");
      await validateReferences(q, PlaybookContentSchema.parse(before.content));
      // Publishing is one atomic switch: no planner can read two active SOP versions for this slug.
      await q`
        update playbook_versions set status = 'disabled',
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
        where slug = ${before.slug} and status = 'published'`;
      const [published] = await q<Row[]>`
        update playbook_versions set status = 'published', published_at = clock_timestamp(),
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
        where id = ${before.id} returning *`;
      return toManaged(published);
    });
  }

  async disable(actorId: string, id: string, expectedUpdatedAt: string): Promise<ManagedPlaybook> {
    return this.asMo(actorId, async (q) => {
      const before = await rowOf(q, id, true);
      checkExpected(before, expectedUpdatedAt);
      if (before.status !== "published")
        throw new CommandError("conflict", "Only a published playbook can be disabled");
      const [disabled] = await q<Row[]>`
        update playbook_versions set status = 'disabled',
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
        where id = ${before.id} returning *`;
      return toManaged(disabled);
    });
  }

  async deleteDraft(actorId: string, id: string, expectedUpdatedAt: string): Promise<void> {
    await this.asMo(actorId, async (q) => {
      const before = await rowOf(q, id, true);
      checkExpected(before, expectedUpdatedAt);
      if (before.status !== "draft")
        throw new CommandError("conflict", "Only a draft can be deleted");
      await q`delete from playbook_versions where id = ${before.id}`;
    });
  }

  /** Server-side planner input; draft and disabled SOPs can never enter a recommendation. */
  async published(): Promise<ManagedPlaybook[]> {
    const rows = await this.database.query()<Row[]>`
      select * from playbook_versions where status = 'published' order by slug, version desc`;
    return rows.map(toManaged);
  }
}

export const playbookStore = new PlaybookStore();
