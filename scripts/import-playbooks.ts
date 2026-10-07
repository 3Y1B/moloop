/** Import a human-provided multi-document YAML atomically; never overwrite Mo's existing versions. */
import { parseAllDocuments } from "yaml";
import type { TransactionSql } from "postgres";

import { PlaybookContentSchema } from "../src/lib/mobilization-contracts";
import { PlaybookStore } from "../src/server/playbooks/store";
import { sql } from "../src/server/world";

declare const Bun: { file(path: string): { text(): Promise<string> } };
const file = process.argv[2] ?? "supabase/playbooks/festival-emergency.yaml";
const raw = await Bun.file(file).text();
const digest = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))),
)
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");
const documents = parseAllDocuments(raw, { uniqueKeys: true });
if (!documents.length || documents.some((document) => document.errors.length))
  throw new Error("Playbook YAML is empty or contains invalid/duplicate keys");
const books = documents.map((document) => {
  const supplied = document.toJSON() as Record<string, unknown>;
  if (supplied.version !== 1 || supplied.status !== "published")
    throw new Error(
      "Import expects supplied version 1 published playbooks; manage later revisions in Mo's editor",
    );
  return PlaybookContentSchema.parse({
    ...supplied,
    source: `User-provided festival_emergency_playbooks.yaml; sha256:${digest}`,
  });
});
if (new Set(books.map((book) => book.slug)).size !== books.length)
  throw new Error("Duplicate playbook slugs in the supplied file");

const db = sql();
try {
  const result = await db.begin(async (tx) => {
    const [mo] = await tx<{ id: string }[]>`
      select p.id from profiles p join auth.users u on u.id = p.id
      where u.email = ${process.env.PLAYBOOK_MO_EMAIL ?? "mo@moloop.test"}
        and p.role::text in ('coordinator','safety_lead','admin')`;
    if (!mo) throw new Error("No authorized Mo account; set PLAYBOOK_MO_EMAIL to an existing Mo");
    // Store's publication/reference checks still run. Savepoints keep all 10 versions in one commit.
    const store = new PlaybookStore({
      query: () => tx,
      transaction: <T>(work: (q: TransactionSql) => Promise<T>) => tx.savepoint(work) as Promise<T>,
    });
    const imported: string[] = [];
    const retained: string[] = [];
    for (const content of books) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${content.slug}, 73190))`;
      const existing = await tx<{ content: unknown; status: string }[]>`
        select content, status from playbook_versions where slug = ${content.slug} order by version`;
      if (existing.length) {
        const exact = existing.some(
          (row) =>
            JSON.stringify(PlaybookContentSchema.parse(row.content)) === JSON.stringify(content),
        );
        if (!exact)
          throw new Error(
            `${content.slug} already exists with different content; import stopped without overwriting Mo's work`,
          );
        retained.push(content.slug);
        continue;
      }
      const draft = await store.saveDraft(mo.id, { id: null, expectedUpdatedAt: null, content });
      const published = await store.publish(mo.id, draft.id, draft.updatedAt);
      imported.push(`${published.content.slug} v${published.version}`);
    }
    return { imported, retained };
  });
  console.log(
    `Imported ${result.imported.length}; retained ${result.retained.length} unchanged source versions.`,
  );
  for (const slug of result.imported) console.log(`Published ${slug}`);
  console.log("Mo can revise, publish a new version, or disable each SOP from Playbooks.");
} finally {
  await db.end();
}
