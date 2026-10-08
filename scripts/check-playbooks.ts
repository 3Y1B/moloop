/**
 * Mo's SOP management integration check. Needs local migrations and seeded crew, not a running server.
 * Published test versions exist only inside a transaction which is rolled back; concurrency checks
 * create drafts under one unique test slug and remove only those drafts afterward.
 *
 *   bun scripts/check-playbooks.ts
 */
import { Hono } from "hono";
import type { TransactionSql } from "postgres";

import { CommandError } from "../src/lib/batch";
import type { ManagedPlaybook, PlaybookContent } from "../src/lib/mobilization-contracts";
import { requireCaller, type AuthEnv, type Caller } from "../src/server/http/auth";
import { createPlaybookRoutes } from "../src/server/http/playbooks";
import { PlaybookStore } from "../src/server/playbooks/store";
import { sql } from "../src/server/world";

const q = sql();
const run = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const lifecycleSlug = `check-playbooks-lifecycle-${run}`;
const concurrencySlug = `check-playbooks-race-${run}`;
const rollback = new Error("roll back the published test SOPs");

function check(label: string, condition: unknown): asserts condition {
  if (!condition) throw new Error(label);
  console.log(`ok  ${label}`);
}

async function rejects(work: Promise<unknown>, matches: (error: unknown) => boolean) {
  try {
    await work;
  } catch (error) {
    if (matches(error)) return;
    throw error;
  }
  throw new Error("Expected this operation to be rejected");
}

function content(slug: string): PlaybookContent {
  return {
    schemaVersion: 1,
    slug,
    title: "Integration test SOP — never production guidance",
    appliesWhen: "Only while this isolated integration check is running.",
    requiredInputs: ["roster", "venue"],
    decisionPoints: [],
    constraints: [
      { id: "human-approval", instruction: "Test instructions require Mo's approval." },
    ],
    actions: [
      {
        id: "test-assessment",
        requirement: "must",
        teamSlug: "first-aid",
        title: "Test assessment",
        instructions: "This is a test action, not official safety guidance.",
        peopleNeeded: null,
        staffingGuidance: "The SOP does not prescribe a headcount.",
        requiredSkills: ["first-aid-cert"],
        completionCriteria: "The isolated test records its result.",
        locationGuidance: "Use the location provided in the test context.",
      },
    ],
    source: "Ephemeral integration fixture; rolled back after verification.",
  };
}

try {
  const [mo] = await q<{ id: string }[]>`
    select id from profiles where role::text in ('coordinator', 'safety_lead', 'admin') limit 1`;
  const [volunteer] = await q<{ id: string }[]>`
    select id from profiles where role = 'volunteer' limit 1`;
  if (!mo || !volunteer) throw new Error("Seed local Mo and a volunteer before running this check");

  try {
    await q.begin(async (tx) => {
      const store = new PlaybookStore({
        query: () => tx,
        transaction: <T>(work: (q: TransactionSql) => Promise<T>) =>
          tx.savepoint(work) as Promise<T>,
      });
      let caller: Caller | undefined = { kind: "crew", id: mo.id, role: "coordinator" };
      const app = new Hono<AuthEnv>();
      app.use("*", async (c, next) => {
        if (caller) c.set("caller", caller);
        await next();
      });
      app.route("/api", createPlaybookRoutes(store));
      const authenticatedApp = new Hono<AuthEnv>();
      authenticatedApp.use("/api/*", requireCaller);
      authenticatedApp.route("/api", createPlaybookRoutes(store));
      type Body = { error?: string; playbook?: ManagedPlaybook; playbooks?: ManagedPlaybook[] };
      async function call(name: string, args: unknown = {}) {
        const response = await app.request(`/api/playbooks/${name}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        return { status: response.status, body: (await response.json()) as Body };
      }
      async function saved(args: unknown): Promise<ManagedPlaybook> {
        const result = await call("saveDraft", args);
        if (result.status !== 200 || !result.body.playbook)
          throw new Error(JSON.stringify(result.body));
        return result.body.playbook;
      }
      /** Simulate the database role/JWT claims Supabase applies, always restoring them by rollback. */
      async function asAuthenticated<T>(
        subject: string,
        work: (q: TransactionSql) => Promise<T>,
      ): Promise<T> {
        const restore = new Error("restore the RLS test session");
        let value: T | undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`set local role authenticated`;
            await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: subject, role: "authenticated" })}, true)`;
            value = await work(sp);
            throw restore;
          });
        } catch (error) {
          if (error !== restore) throw error;
        }
        return value as T;
      }

      check(
        "the real auth middleware rejects a missing JWT",
        (
          await authenticatedApp.request("/api/playbooks/list", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status === 401,
      );
      check(
        "the real auth middleware rejects an invalid JWT",
        (
          await authenticatedApp.request("/api/playbooks/list", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer invalid-session",
            },
            body: "{}",
          })
        ).status === 401,
      );

      caller = undefined;
      check("missing session is rejected", (await call("list")).status === 401);
      caller = { kind: "guest", id: volunteer.id };
      check("a guest cannot list SOPs", (await call("list")).status === 403);
      caller = { kind: "crew", id: volunteer.id, role: "team_lead" };
      check("a team lead cannot manage venue-wide SOPs", (await call("list")).status === 403);
      await rejects(
        store.saveDraft(volunteer.id, {
          id: null,
          expectedUpdatedAt: null,
          content: content(lifecycleSlug),
        }),
        (error: unknown) => error instanceof CommandError && error.code === "forbidden",
      );
      console.log("ok  direct store calls also enforce Mo's database role");
      caller = { kind: "crew", id: mo.id, role: "coordinator" };

      check(
        "malformed drafts are rejected",
        (await call("saveDraft", { content: {} })).status === 400,
      );
      const invalidSkill = content(lifecycleSlug);
      invalidSkill.actions[0].requiredSkills = ["check-nonexistent-skill"];
      check(
        "unknown roster skills are rejected",
        (
          await call("saveDraft", {
            id: null,
            expectedUpdatedAt: null,
            content: invalidSkill,
          })
        ).status === 400,
      );
      const duplicateActions = content(lifecycleSlug);
      duplicateActions.actions.push({ ...duplicateActions.actions[0] });
      check(
        "ambiguous duplicate action citations are rejected",
        (
          await call("saveDraft", {
            id: null,
            expectedUpdatedAt: null,
            content: duplicateActions,
          })
        ).status === 400,
      );
      const duplicateDecisions = content(lifecycleSlug);
      duplicateDecisions.decisionPoints = [
        { id: "mo-decision", owner: "mo", question: "Test question for Mo." },
        { id: "mo-decision", owner: "mo", question: "A conflicting question with the same ID." },
      ];
      check(
        "duplicate decision point IDs are rejected",
        (
          await call("saveDraft", {
            id: null,
            expectedUpdatedAt: null,
            content: duplicateDecisions,
          })
        ).status === 400,
      );

      const first = await saved({
        id: null,
        expectedUpdatedAt: null,
        content: content(lifecycleSlug),
      });
      check(
        "a new SOP starts as draft v1 with no publication time",
        first.version === 1 && first.status === "draft" && first.publishedAt === null,
      );
      const readAs = (subject: string) =>
        asAuthenticated(
          subject,
          async (sp) =>
            sp<{ id: string }[]>`select id from playbook_versions where id = ${first.id}`,
        );
      check("Mo can read SOP drafts under Supabase RLS", (await readAs(mo.id)).length === 1);
      check(
        "volunteers cannot read SOP drafts through Supabase",
        (await readAs(volunteer.id)).length === 0,
      );
      check(
        "authenticated guests without a crew profile cannot read SOP drafts",
        (await readAs(crypto.randomUUID())).length === 0,
      );
      const denied = (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "42501";
      await rejects(
        asAuthenticated(mo.id, async (sp) => {
          await sp`insert into playbook_versions (slug, version, status, content, created_by)
          values (${lifecycleSlug}, 999, 'draft', ${sp.json(first.content)}, ${mo.id})`;
        }),
        denied,
      );
      await rejects(
        asAuthenticated(mo.id, async (sp) => {
          await sp`update playbook_versions set content = ${sp.json({ ...first.content, title: "Direct authenticated edit" })} where id = ${first.id}`;
        }),
        denied,
      );
      await rejects(
        asAuthenticated(mo.id, async (sp) => {
          await sp`delete from playbook_versions where id = ${first.id}`;
        }),
        denied,
      );
      console.log("ok  even Mo cannot bypass the server with direct authenticated writes");
      const edited = await saved({
        id: first.id,
        expectedUpdatedAt: first.updatedAt,
        content: { ...first.content, title: "Edited test SOP" },
      });
      check(
        "saving preserves version identity and changes its concurrency token",
        edited.id === first.id && edited.version === 1 && edited.updatedAt !== first.updatedAt,
      );
      check(
        "a stale browser cannot overwrite another edit",
        (
          await call("saveDraft", {
            id: first.id,
            expectedUpdatedAt: first.updatedAt,
            content: first.content,
          })
        ).status === 409,
      );
      check(
        "a stale browser cannot publish newer unseen edits",
        (
          await call("publish", {
            id: first.id,
            expectedUpdatedAt: first.updatedAt,
          })
        ).status === 409,
      );

      const publishResult = await call("publish", {
        id: edited.id,
        expectedUpdatedAt: edited.updatedAt,
      });
      const published = publishResult.body.playbook;
      check(
        "Mo explicitly publishes the current draft",
        publishResult.status === 200 &&
          published?.status === "published" &&
          published.publishedAt != null,
      );
      check(
        "published content cannot be edited in place",
        (
          await call("saveDraft", {
            id: published.id,
            expectedUpdatedAt: published.updatedAt,
            content: { ...published.content, title: "Forbidden rewrite" },
          })
        ).status === 409,
      );
      check(
        "published history cannot be deleted through the API",
        (
          await call("deleteDraft", {
            id: published.id,
            expectedUpdatedAt: published.updatedAt,
          })
        ).status === 409,
      );
      await rejects(
        tx.savepoint(async (sp) => {
          await sp`update playbook_versions set content = ${sp.json({ ...published.content, title: "Direct SQL rewrite" })} where id = ${published.id}`;
        }),
        (error) => error instanceof Error && /immutable/.test(error.message),
      );
      await rejects(
        tx.savepoint(async (sp) => {
          await sp`delete from playbook_versions where id = ${published.id}`;
        }),
        (error) => error instanceof Error && /cannot be deleted/.test(error.message),
      );
      console.log("ok  database guards preserve published bodies and history");

      const revisionResult = await call("revise", { id: published.id });
      const revision = revisionResult.body.playbook;
      check(
        "revision copies the exact SOP into a new draft version",
        revisionResult.status === 200 &&
          revision?.version === 2 &&
          revision.status === "draft" &&
          JSON.stringify(revision.content) === JSON.stringify(published.content),
      );
      const changed = await saved({
        id: revision.id,
        expectedUpdatedAt: revision.updatedAt,
        content: { ...revision.content, title: "Revised test SOP" },
      });
      const revisionPublishedResult = await call("publish", {
        id: changed.id,
        expectedUpdatedAt: changed.updatedAt,
      });
      const revisionPublished = revisionPublishedResult.body.playbook;
      check(
        "publishing a revision activates it",
        revisionPublishedResult.status === 200 && revisionPublished?.status === "published",
      );
      const listed = await call("list");
      const original = listed.body.playbooks?.find((playbook) => playbook.id === published.id);
      check(
        "the superseded SOP is disabled with its original content intact",
        original?.status === "disabled" &&
          JSON.stringify(original.content) === JSON.stringify(published.content),
      );
      const plannerBooks = (await store.published()).filter(
        (playbook) => playbook.content.slug === lifecycleSlug,
      );
      check(
        "the planner reads exactly the one published version",
        plannerBooks.length === 1 && plannerBooks[0].id === revisionPublished.id,
      );

      const disabledResult = await call("disable", {
        id: revisionPublished.id,
        expectedUpdatedAt: revisionPublished.updatedAt,
      });
      const disabled = disabledResult.body.playbook;
      check(
        "Mo can disable a published SOP",
        disabledResult.status === 200 && disabled?.status === "disabled",
      );
      check(
        "disabled SOPs no longer feed the planner",
        !(await store.published()).some((playbook) => playbook.content.slug === lifecycleSlug),
      );
      const lastDraftResult = await call("revise", { id: disabled.id });
      const lastDraft = lastDraftResult.body.playbook;
      check(
        "a disabled SOP can be revised but cannot be reactivated in place",
        lastDraftResult.status === 200 &&
          lastDraft?.version === 3 &&
          (await call("publish", { id: disabled.id, expectedUpdatedAt: disabled.updatedAt }))
            .status === 409,
      );
      check(
        "an existing draft does not create another revision",
        (await call("revise", { id: lastDraft.id })).status === 409,
      );
      check(
        "draft deletion also checks the concurrency token",
        (await call("deleteDraft", { id: lastDraft.id, expectedUpdatedAt: first.updatedAt }))
          .status === 409,
      );
      check(
        "only the current draft can be deleted",
        (await call("deleteDraft", { id: lastDraft.id, expectedUpdatedAt: lastDraft.updatedAt }))
          .status === 200,
      );
      check(
        "the deleted draft is absent",
        !(await store.list(mo.id)).some((playbook) => playbook.id === lastDraft.id),
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [leftover] = await q<{ count: number }[]>`
    select count(*)::int as count from playbook_versions where slug = ${lifecycleSlug}`;
  check("all published test SOPs disappear through rollback", leftover.count === 0);

  const store = new PlaybookStore();
  try {
    const drafts = await Promise.all(
      Array.from({ length: 3 }, () =>
        store.saveDraft(mo.id, {
          id: null,
          expectedUpdatedAt: null,
          content: content(concurrencySlug),
        }),
      ),
    );
    check(
      "concurrent draft creation allocates distinct sequential versions",
      drafts
        .map((draft) => draft.version)
        .sort()
        .join() === "1,2,3",
    );
    const target = drafts[0];
    const writes = await Promise.allSettled(
      ["first writer", "second writer"].map((title) =>
        store.saveDraft(mo.id, {
          id: target.id,
          expectedUpdatedAt: target.updatedAt,
          content: { ...target.content, title },
        }),
      ),
    );
    check(
      "competing edits permit one write and reject the stale writer",
      writes.filter((write) => write.status === "fulfilled").length === 1 &&
        writes.some(
          (write) =>
            write.status === "rejected" &&
            write.reason instanceof CommandError &&
            write.reason.code === "conflict",
        ),
    );
  } finally {
    // Only the unique draft-only test slug is touched; published versions are never deleted.
    await q`delete from playbook_versions where slug = ${concurrencySlug} and status = 'draft'`;
  }
  console.log("\nAll playbook management checks passed.");
} finally {
  await q.end();
}
