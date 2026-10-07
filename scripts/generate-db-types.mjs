/**
 * Regenerate the database contract without letting Supabase CLI progress messages leak into the
 * TypeScript file. The output is only replaced after generation and formatting both succeed.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "moloop-db-types-"));
const generated = join(temp, "database.types.ts");
const output = resolve("src/lib/database.types.ts");

function run(command, args, { showStdout = true, ...options } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (showStdout && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${command} exited with ${result.status}`);
  return result;
}

try {
  const generatedTypes = run("supabase", ["gen", "types", "typescript", "--local"], {
    showStdout: false,
  });
  writeFileSync(generated, generatedTypes.stdout);
  run("npx", ["--yes", "oxfmt", "--write", generated]);
  writeFileSync(output, readFileSync(generated));
  console.log(`Wrote ${output}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
