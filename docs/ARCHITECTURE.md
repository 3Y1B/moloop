# Moloop architecture

```
report (text/voice, any language)
  -> POST /api/reports                         src/app/api/reports+api.ts
  -> route: detect lang, translate, "can AI handle?"   pipeline/route.ts
       yes -> P3 responder -> reply to reporter -> task(handled_by=ai, resolved)
       no  -> triage (parallel): team classifier (Jev) | priority classifier (Jev) | rewrite (LLM)   pipeline/triage.ts
           -> assignment (deterministic rank, LLM rationale) -> task(open) + task_assignments(proposed) + agent_actions(pending)
  -> Mo / team lead approves in app -> notify volunteers -> volunteer accepts -> en_route -> on_scene -> done
```

Rules
- Agents propose, people approve. Only P3 info answers are closed by AI alone, and the P3 agent can bail to triage.
- Fail closed: any pipeline error means a human sees the raw report (TODO: write a fallback P2 task on error).
- Every stage's output is stored in `triage_runs` (audit + demo of the reasoning).

Layout
- `supabase/migrations/*` schema, `supabase/seed.sql` teams/skills/zones/playbooks
- `src/lib/schema/*` zod contracts shared by client and server
- `src/server/models/*` Jev (classifier) + Luna (LLM) seams, mocks when `USE_LIVE_MODELS!=1`
- `src/server/pipeline/*` stages; `src/server/store.ts` persistence (memory fallback without Supabase env)
