/**
 * Publish the Mo-requested staffing revision for the 300-volunteer demo.
 * Dry run by default; --apply publishes all active SOP revisions in one transaction.
 * Original YAML, published history, Mo drafts, existing analyses and tasks are never overwritten.
 *
 *   bun scripts/scale-playbook-staffing.ts
 *   bun scripts/scale-playbook-staffing.ts --apply
 *   bun scripts/scale-playbook-staffing.ts --factor 2 --apply
 */
import type { TransactionSql } from 'postgres';

import type { ManagedPlaybook } from '../src/lib/mobilization-contracts';
import { additionalDemoStaffingRevisionNote, reviseDemoStaffing } from '../src/lib/playbook-staffing';
import { PlaybookStore } from '../src/server/playbooks/store';
import { sql } from '../src/server/world';

const args = process.argv.slice(2);
const argumentError = () => new Error('Use [--factor 2|3] [--apply]. No arguments previews the original revision.');
if (args.filter(arg => arg === '--apply').length > 1) throw argumentError();
const apply = args.includes('--apply');
const remaining = args.filter(arg => arg !== '--apply');
let additionalFactor: 2 | 3 | undefined;
if (remaining.length) {
  if (remaining.length !== 2 || remaining[0] !== '--factor' || !['2', '3'].includes(remaining[1]))
    throw argumentError();
  additionalFactor = remaining[1] === '2' ? 2 : 3;
}
const revisionOptions = additionalFactor ? {
  factor: additionalFactor,
  unspecifiedCrew: additionalFactor === 2 ? 12 as const : 18 as const,
  revisionNote: additionalDemoStaffingRevisionNote(additionalFactor),
} : undefined;
const db = sql();

function samePublished(before: ManagedPlaybook[], after: ManagedPlaybook[]) {
  return before.length === after.length && before.every((book) => {
    const current = after.find((row) => row.id === book.id);
    return current?.updatedAt === book.updatedAt &&
      JSON.stringify(current.content) === JSON.stringify(book.content);
  });
}

try {
  const [mo] = await db<{ id: string }[]>`
    select p.id from profiles p join auth.users u on u.id = p.id
    where u.email = ${process.env.PLAYBOOK_MO_EMAIL ?? 'mo@moloop.test'}
      and p.role::text in ('coordinator', 'safety_lead', 'admin')`;
  if (!mo) throw new Error('Set PLAYBOOK_MO_EMAIL to an existing authorized Mo account.');
  const store = new PlaybookStore();
  const published = (await store.list(mo.id)).filter((book) => book.status === 'published');
  if (!published.length) throw new Error('No published playbooks are available to revise.');
  const prepared = published.map((book) => ({ book, revision: reviseDemoStaffing(book.content, revisionOptions) }));
  const changed = prepared.filter(({ revision }) => !revision.alreadyApplied);
  const changes = changed.flatMap(({ revision }) => revision.changes);
  console.log(`${apply ? 'Publishing' : 'Preview'}: ${changed.length} SOP revisions; ${changes.length} action staffing settings.`);
  console.log(`Fixed headcounts multiplied by ${revisionOptions?.factor ?? 3}: ${changes.filter((change) => change.before !== null).length}; unspecified headcounts given a ${revisionOptions?.unspecifiedCrew ?? 6}-person demo baseline: ${changes.filter((change) => change.before === null).length}.`);
  for (const { book, revision } of prepared)
    console.log(`${book.content.title}: ${revision.alreadyApplied ? 'already revised; retained' : revision.changes.map((change) => `${change.before ?? 'unspecified'} → ${change.after}`).join(', ')}`);
  if (!apply) {
    console.log('Preview only. Pass --apply to publish new versions; Mo can still revise every staffing setting.');
  } else if (!changed.length) {
    console.log('Already applied. No versions or staffing settings changed.');
  } else {
    const result = await db.begin(async (tx) => {
      // Use the same locks and publication rules as Mo's editor. Lock in a stable order.
      const ordered = [...published].sort((a, b) => a.content.slug.localeCompare(b.content.slug));
      for (const book of ordered)
        await tx`select pg_advisory_xact_lock(hashtextextended(${book.content.slug}, 73190))`;
      // Mo's disable command locks the version row, not the slug: protect that edit too.
      for (const book of ordered)
        await tx`select id from playbook_versions where id = ${book.id} for update`;
      const transactionalStore = new PlaybookStore({
        query: () => tx,
        transaction: <T>(work: (q: TransactionSql) => Promise<T>) => tx.savepoint(work) as Promise<T>,
      });
      const current = (await transactionalStore.list(mo.id)).filter((book) => book.status === 'published');
      if (!samePublished(published, current))
        throw new Error('Published playbooks changed after the preview. Nothing was published; review and rerun.');
      const active = await tx<{ count: number }[]>`
        select count(*)::int as count from mobilization_runs
        where status = 'running' and updated_at > clock_timestamp() - interval '5 minutes'`;
      if (active[0]?.count)
        throw new Error('A situation analysis is still running. Wait for it to finish before revising SOPs.');
      const versions: { title: string; previousVersion: number; version: number; actions: number }[] = [];
      for (const { book, revision } of changed) {
        const draft = await transactionalStore.saveDraft(mo.id, {
          id: null, expectedUpdatedAt: null, content: revision.content,
        });
        const next = await transactionalStore.publish(mo.id, draft.id, draft.updatedAt);
        versions.push({ title: next.content.title, previousVersion: book.version,
          version: next.version, actions: next.content.actions.length });
      }
      return versions;
    });
    for (const version of result)
      console.log(`Published ${version.title}: v${version.previousVersion} → v${version.version}, ${version.actions} actions.`);
    console.log('All revisions committed together. Original versions and existing mobilizations are retained.');
  }
} finally {
  await db.end();
}
