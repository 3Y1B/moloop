import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { CommandError } from "@/lib/batch";
import { SavePlaybookDraftSchema } from "@/lib/mobilization-contracts";
import { playbookStore, type PlaybookStore } from "../playbooks/store";
import type { AuthEnv } from "./auth";

const Id = z.uuid();
const Versioned = z.object({ id: Id, expectedUpdatedAt: z.string().min(1).max(80) });
const STATUS: Record<CommandError["code"], ContentfulStatusCode> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

/** Mounted beneath /api after requireCaller. Only Mo may read or change human-provided SOPs. */
export function createPlaybookRoutes(store: PlaybookStore = playbookStore) {
  const routes = new Hono<AuthEnv>();

  function route<S extends z.ZodType>(
    name: string,
    schema: S,
    handle: (args: z.infer<S>, actorId: string) => Promise<unknown>,
  ) {
    routes.post(`/playbooks/${name}`, async (c) => {
      const caller = c.get("caller");
      if (!caller) return c.json({ error: "unauthenticated" }, 401);
      if (caller.kind !== "crew" || !["coordinator", "safety_lead", "admin"].includes(caller.role))
        return c.json({ error: "forbidden" }, 403);
      const parsed = schema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json({ error: `invalid body: ${z.prettifyError(parsed.error)}` }, 400);
      try {
        return c.json((await handle(parsed.data, caller.id)) ?? {});
      } catch (error) {
        if (error instanceof CommandError)
          return c.json({ error: error.message }, STATUS[error.code]);
        console.error(`/api/playbooks/${name} failed`, error);
        return c.json({ error: "internal" }, 500);
      }
    });
  }

  route("list", z.object({}), async (_args, actorId) => ({ playbooks: await store.list(actorId) }));
  route("saveDraft", SavePlaybookDraftSchema, async (args, actorId) => ({
    playbook: await store.saveDraft(actorId, args),
  }));
  route("revise", z.object({ id: Id }), async ({ id }, actorId) => ({
    playbook: await store.revise(actorId, id),
  }));
  route("publish", Versioned, async ({ id, expectedUpdatedAt }, actorId) => ({
    playbook: await store.publish(actorId, id, expectedUpdatedAt),
  }));
  route("disable", Versioned, async ({ id, expectedUpdatedAt }, actorId) => ({
    playbook: await store.disable(actorId, id, expectedUpdatedAt),
  }));
  route("deleteDraft", Versioned, async ({ id, expectedUpdatedAt }, actorId) => {
    await store.deleteDraft(actorId, id, expectedUpdatedAt);
  });
  return routes;
}

export const playbookRoutes = createPlaybookRoutes();
