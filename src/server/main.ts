/**
 * The server: one long-running process. Serves the command API; the scheduler joins it in phase 2.
 *
 *   bun --watch src/server/main.ts
 */
import { app } from './http/app';

const port = Number(process.env.PORT ?? 8787);
console.log(`server listening on :${port}`);

export default { port, fetch: app.fetch };
