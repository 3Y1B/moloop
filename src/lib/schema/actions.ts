import { z } from 'zod';

// Payloads for agent_actions.payload, discriminated by action type.
// Nothing here executes until a human flips agent_actions.status to 'approved'.
export const AgentActionPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign_volunteer'), taskId: z.string().uuid(), volunteerIds: z.array(z.string().uuid()), helperIds: z.array(z.string().uuid()).optional() }),
  z.object({ type: z.literal('broadcast_message'), scope: z.enum(['team', 'zone', 'broadcast']), targetId: z.string().optional(), body: z.string() }),
  z.object({ type: z.literal('move_team'), teamSlug: z.string(), fromZoneSlug: z.string().nullable(), toZoneSlug: z.string(), volunteerIds: z.array(z.string().uuid()) }),
  z.object({ type: z.literal('draft_incident_report'), taskId: z.string().uuid(), markdown: z.string() }),
  z.object({ type: z.literal('request_shift_cover'), shiftId: z.string().uuid(), candidateIds: z.array(z.string().uuid()) }),
  // Deliberately never auto-executable, UI must require a deliberate human confirm.
  z.object({ type: z.literal('escalate_emergency_services'), taskId: z.string().uuid(), script: z.string() }),
]);
export type AgentActionPayload = z.infer<typeof AgentActionPayload>;
