import { DEFAULT_POLICY, setPolicy, type Policy } from '@/lib/lifecycle';

/**
 * Lifecycle timings from env, so a rehearsal or a test can run fast:
 *   POLICY_SCALE=0.05            every timing × 0.05 (2 min ack → 6 s)
 *   POLICY_ACK_TIMEOUT_MS, POLICY_NUDGE_GAP_MS, POLICY_AUTO_ASSIGN_MS   one timing, after scaling
 */
export function policyFromEnv(env: Record<string, string | undefined> = process.env): Policy {
  const num = (k: string) => (env[k] ? Number(env[k]) : undefined);
  const scale = num('POLICY_SCALE') ?? 1;
  const s = (n: number) => Math.round(n * scale);
  const each = <K extends string>(r: Record<K, number>) => Object.fromEntries(Object.entries<number>(r).map(([k, v]) => [k, s(v)])) as Record<K, number>;
  const d = DEFAULT_POLICY;
  return {
    ackTimeoutMs: num('POLICY_ACK_TIMEOUT_MS') ?? s(d.ackTimeoutMs),
    nudgeGapMs: num('POLICY_NUDGE_GAP_MS') ?? s(d.nudgeGapMs),
    etaMs: each(d.etaMs),
    delayExtendMs: s(d.delayExtendMs),
    bumpToCoordinatorMs: each(d.bumpToCoordinatorMs),
    autoAssignMs: num('POLICY_AUTO_ASSIGN_MS') ?? s(d.autoAssignMs),
  };
}

export const applyPolicyFromEnv = () => setPolicy(policyFromEnv());
