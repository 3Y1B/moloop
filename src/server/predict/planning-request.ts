import type { MobilizationOutput, PlanningSnapshot } from '@/lib/mobilization-contracts';
import { createActionMobilizationOutput } from './action-output';
import { focusedPlanningInput } from './focused-input';
import { createPlaybookRetrieval } from './playbook-retrieval';
import { MOBILIZATION_TOOL_PROMPT_VERSION, MOBILIZATION_TOOL_SYSTEM_PROMPT } from './prompts/mobilization-tools';
import { validateMobilizationOutput } from './validate';

/** One immutable request contract, shared by transport and persisted audit; no DB mutations. */
export function createMobilizationPlanningRequest(snapshot: PlanningSnapshot) {
  const captured = structuredClone(snapshot);
  const retrieval = createPlaybookRetrieval(captured);
  let selectedKeys: string[] = [];
  let reading = false;
  let auditedRead = false;
  const contract = createActionMobilizationOutput(captured, () => selectedKeys);
  return {
    promptVersion: `${MOBILIZATION_TOOL_PROMPT_VERSION}.required-actions.v2`,
    system: `${MOBILIZATION_TOOL_SYSTEM_PROMPT}\n${contract.promptSupplement}`,
    prompt: JSON.stringify(focusedPlanningInput(captured)),
    args: retrieval.args,
    schema: () => {
      if (!auditedRead) throw new Error('The final contract requires an audited SOP read');
      return contract.schema();
    },
    async read(args: Parameters<typeof retrieval.read>[0], audit: (result: ReturnType<typeof retrieval.read>) => Promise<void>) {
      if (reading) throw new Error('Only one audited SOP batch is allowed');
      reading = true;
      const result = retrieval.read(args);
      const capturedKeys = result.playbooks.map((book) => book.playbookKey);
      await audit(result);
      selectedKeys = capturedKeys;
      auditedRead = true;
      return JSON.stringify(result);
    },
    expand(wire: unknown) {
      if (!auditedRead) throw new Error('The output requires an audited SOP read');
      return contract.expand(wire);
    },
    validate(output: MobilizationOutput) {
      return [...retrieval.validate(output),
        ...validateMobilizationOutput(output, captured, captured.skills.map((skill) => skill.slug))];
    },
  };
}
