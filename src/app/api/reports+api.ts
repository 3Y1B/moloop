import { ReportInput } from '@/lib/schema';
import { handleReport } from '@/server/pipeline';

export async function POST(request: Request) {
  const parsed = ReportInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return Response.json(await handleReport(parsed.data));
  } catch (e) {
    console.error('pipeline failed', e);
    // Never leave a reporter hanging: fail closed to a human.
    return Response.json({ error: 'pipeline_failed' }, { status: 502 });
  }
}
