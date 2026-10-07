/** The only Bun-specific server capability this adapter needs; no runtime typings/dependency required. */
export type RequestIdleTimeoutServer = {
  timeout(request: Request, seconds: number): void;
};

/** Model generation has its own bounded deadlines; Bun must not close this quiet HTTP response first. */
export function applyMobilizationIdleTimeout(request: Request, server: RequestIdleTimeoutServer): void {
  if (request.method === 'POST' && new URL(request.url).pathname === '/api/simulateMobilization') {
    server.timeout(request, 0);
  }
}
