# Mobilization latency and quality checks

## Configuration adopted on 8 October 2026

Mobilization alone uses `gpt-6-sol`, `MOBILIZATION_REASONING_EFFORT=low` and
`MOBILIZATION_SERVICE_TIER=fast`. Other model consumers retain their configuration.
Absent a scoped reasoning setting, the application still defaults to medium.

The [Fast guide](https://developers.openai.com/api/docs/guides/fast-mode) describes
accelerated processing, not a latency guarantee. See the
[Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6-sol)
for supported reasoning settings. The UI therefore says **Estimated 30 seconds**.

## Final three-scenario check

All three samples used the same `mobilization.v16.escalation-evidence` prompt,
required-action wire v2, focused input, Sol / low / Fast, and two Responses requests.
Measurements include planning, local audit capture and semantic validation, but
exclude database proposal commit and browser rendering.

| Scenario | Time | Server validation | Independent human review |
| --- | ---: | --- | --- |
| Heat and water shortage | 18.671 s | Pass | Pass |
| Storm | 20.863 s | Pass | Pass |
| Crowd surge and extraction needs | 19.422 s | Pass | Pass |

Human review compared actual tool-selected SOP versions, every mandatory action,
evidence, unconfirmed causes, staffing, both stages/backstages and deadlines. These
are quality checks of these samples, not a guarantee of arbitrary future outputs.
Unverified corridors, treatment readiness and resource availability remain explicit
gaps; the proposed work is not a claim that a full emergency response is executable.

## Exploratory comparisons

83 completed read-only experiments covered eight model identities and eleven
model/reasoning combinations. Prompts, output contracts and input formats evolved
between experiments; these are not a controlled model ranking.

Sol low had 20 schema/semantic-valid samples under 30 seconds out of 25 exploratory
samples. Sol medium had 4 valid samples under 30 out of 19. Luna low was fast but
failed the complex crowd case; GPT-5.4 and GPT-5.4-mini samples did not complete valid
output within the tested budgets. GPT-6.1-sol valid samples took approximately
48–61 seconds. Earlier deterministic passes with unsafe natural-language FULL
coverage were rejected during human review, not adopted.

Raw requests, responses, failed samples and immutable snapshots are retained locally
under ignored `.local/mobilization-experiments/`; never commit these operational
artifacts or secrets. `scripts/benchmark-mobilization.ts` reproduces read-only tests.
No benchmark approves a Mobilization or dispatches a task.

## Safety and failure behavior

All original server checks remain: exact references and source versions, evidence,
required inputs/action accounting, location/team/skills/headcounts, relationship
validation and atomic proposal creation. Failed validation creates no Mobilization;
its failed run and raw audit remain inspectable. No model-generated repair hides the
failure. Mo approval separately requires review of missing facts and staffing gaps,
and rechecks current eligible staff in a transaction. Programmatic validation cannot
prove the truth of free-text root causes or safety instructions; Mo remains the gate.
