import { createClient } from '@supabase/supabase-js';
import type { PipelineOutcome, PriorityResult, ReportInput, RewriteResult, RouteResult, TeamResult, AssignmentProposal } from '@/lib/schema';

export type Candidate = {
  volunteerId: string;
  name: string;
  skills: string[];
  languages: string[];
  distanceM: number | null;
  activeTasks: number;
};

export type TaskDraft = {
  reportId: string;
  triageRunId: string;
  rewrite: RewriteResult;
  priority: PriorityResult['priority'];
  teamSlug: TeamResult['team'] | null;
  handledBy: 'ai' | 'human';
  aiResponse?: string;
  responseLang?: string;
  needsHumanReview: boolean;
};

export interface Store {
  insertReport(input: ReportInput, route: RouteResult): Promise<string>;
  insertTriageRun(run: {
    reportId: string; route: RouteResult; team?: TeamResult; priority?: PriorityResult;
    rewrite?: RewriteResult; assignment?: AssignmentProposal; models: Record<string, string>; latencyMs: number; error?: string;
  }): Promise<string>;
  insertTask(t: TaskDraft): Promise<string>;
  findCandidates(q: { teamSlug: string; zoneSlug: string | null; requiredSkills: string[] }): Promise<Candidate[]>;
  /** Creates task_assignments(status=proposed) + one agent_actions(assign_volunteer) awaiting approval. */
  insertProposal(taskId: string, p: AssignmentProposal): Promise<void>;
}

/** Zero-setup dev store: logs and returns ids. Lets the app + pipeline run before Supabase is wired. */
class MemoryStore implements Store {
  private id = () => crypto.randomUUID();
  async insertReport() { return this.id(); }
  async insertTriageRun() { return this.id(); }
  async insertTask() { return this.id(); }
  async findCandidates() { return []; }
  async insertProposal() {}
}

class SupabaseStore implements Store {
  private db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  private async one(q: PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>) {
    const { data, error } = await q;
    if (error || !data) throw new Error(error?.message ?? 'no row');
    return data;
  }

  async insertReport(input: ReportInput, route: RouteResult) {
    const zone = input.zoneSlug
      ? (await this.db.from('zones').select('id').eq('slug', input.zoneSlug).maybeSingle()).data
      : null;
    const row = await this.one(this.db.from('reports').insert({
      channel: input.channel,
      reporter_kind: input.reporterKind,
      reporter_id: input.reporterId ?? null,
      raw_text: input.rawText,
      media_url: input.mediaUrl ?? null,
      detected_language: route.detectedLanguage,
      text_en: route.textEn,
      zone_id: zone?.id ?? null,
      lat: input.coords?.lat ?? null,
      lng: input.coords?.lng ?? null,
      location_hint: input.locationHint ?? null,
    }).select('id').single());
    return row.id as string;
  }

  async insertTriageRun(r: Parameters<Store['insertTriageRun']>[0]) {
    const row = await this.one(this.db.from('triage_runs').insert({
      report_id: r.reportId,
      route: r.route.decision,
      route_reason: r.route.reason,
      router_conf: r.route.confidence,
      team_result: r.team ?? null,
      priority_result: r.priority ?? null,
      rewrite_result: r.rewrite ?? null,
      assignment_result: r.assignment ?? null,
      models: r.models,
      latency_ms: r.latencyMs,
      error: r.error ?? null,
    }).select('id').single());
    return row.id as string;
  }

  async insertTask(t: TaskDraft) {
    const [team, zone] = await Promise.all([
      t.teamSlug ? this.db.from('teams').select('id').eq('slug', t.teamSlug).maybeSingle() : null,
      t.rewrite.zoneSlug ? this.db.from('zones').select('id').eq('slug', t.rewrite.zoneSlug).maybeSingle() : null,
    ]);
    const row = await this.one(this.db.from('tasks').insert({
      report_id: t.reportId,
      triage_run_id: t.triageRunId,
      title: t.rewrite.title,
      summary: t.rewrite.summary,
      category: t.rewrite.category,
      priority: t.priority,
      team_id: team?.data?.id ?? null,
      zone_id: zone?.data?.id ?? null,
      status: t.handledBy === 'ai' ? 'resolved' : 'open',
      handled_by: t.handledBy,
      ai_response: t.aiResponse ?? null,
      response_lang: t.responseLang ?? null,
      needs_human_review: t.needsHumanReview,
    }).select('id').single());
    await this.db.from('task_events').insert({ task_id: row.id, actor_kind: 'agent', kind: 'created', data: { handledBy: t.handledBy } });
    return row.id as string;
  }

  async findCandidates(_q: Parameters<Store['findCandidates']>[0]): Promise<Candidate[]> {
    // TODO: SQL view/RPC `candidates_for_task(team, zone, skills)`: checked_in assignment on a shift covering now(),
    // team match, required skills (unexpired), count of open task_assignments, distance from last_known_zone.
    return [];
  }

  async insertProposal(taskId: string, p: AssignmentProposal) {
    if (!p.candidates.length) return;
    await this.db.from('task_assignments').insert(
      p.candidates.map((c) => ({ task_id: taskId, volunteer_id: c.volunteerId, rationale: c.rationale, distance_m: c.distanceM })),
    );
    await this.db.from('agent_actions').insert({
      type: 'assign_volunteer',
      task_id: taskId,
      payload: { type: 'assign_volunteer', taskId, volunteerIds: p.candidates.map((c) => c.volunteerId) },
      rationale: p.candidates[0].rationale,
    });
  }
}

export const store: Store = process.env.SUPABASE_URL ? new SupabaseStore() : new MemoryStore();
export type { PipelineOutcome };
