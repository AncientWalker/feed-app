import { WorkflowEntrypoint } from 'cloudflare:workers';
import { makePlan, postPlan, readIssue } from './planner.mjs';

const encoder = new TextEncoder();

function respond(status) {
  return new Response(null, { status });
}

async function validSignature(body, header, secret) {
  if (!/^[0-9a-f]{64}$/i.test(header ?? '')) return false;
  const signature = Uint8Array.from(header.match(/../g), byte => parseInt(byte, 16));
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  return crypto.subtle.verify('HMAC', key, signature, body);
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/webhooks/linear') return respond(404);
    if (request.method !== 'POST') return respond(405);
    if (!env.LINEAR_WEBHOOK_SECRET || !env.LINEAR_TEAM_ID || !env.INTAKE) return respond(503);

    const body = await request.arrayBuffer();
    if (!await validSignature(body, request.headers.get('Linear-Signature'), env.LINEAR_WEBHOOK_SECRET)) {
      return respond(401);
    }

    let event;
    try {
      event = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return respond(400);
    }
    if (!event || typeof event !== 'object') return respond(400);
    if (!Number.isFinite(event.webhookTimestamp) || Math.abs(Date.now() - event.webhookTimestamp) > 60_000) {
      return respond(401);
    }
    if (event.type !== 'Issue') return respond(200);
    const created = event.action === 'create';
    const was = event.updatedFrom;
    const revised = event.action === 'update' && was &&
      (Object.hasOwn(was, 'title') || Object.hasOwn(was, 'description'));
    if (!created && !revised) return respond(200);

    const issue = event.data;
    if (!issue || typeof issue.teamId !== 'string') return respond(400);
    if (issue.teamId !== env.LINEAR_TEAM_ID) return respond(200);
    if (typeof issue.id !== 'string' || !issue.id || typeof issue.title !== 'string' ||
        typeof issue.createdAt !== 'string' || !Number.isFinite(Date.parse(issue.createdAt))) {
      return respond(400);
    }

    const identifier = issue.identifier ?? null;
    try {
      if (created) {
        const result = await env.INTAKE.prepare(`
          INSERT INTO issue_intake (
            issue_id, identifier, title, description, issue_url, team_id, project_id,
            priority, state_id, created_at, received_at, delivery_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(issue_id) DO NOTHING
        `).bind(
          issue.id, identifier, issue.title, issue.description ?? null, event.url ?? issue.url ?? null,
          issue.teamId, issue.projectId ?? null, issue.priority ?? null, issue.stateId ?? null,
          issue.createdAt, new Date().toISOString(), request.headers.get('Linear-Delivery')
        ).run();
        if (!result.success) return respond(503);
        if (result.meta.changes === 1) {
          console.log(JSON.stringify({ event: 'linear.issue.received', issueId: issue.id, identifier }));
        }
      }
      if (env.OPENAI_API_KEY && env.LINEAR_API_KEY) {
        const revision = Date.parse(issue.updatedAt ?? event.createdAt);
        if (revised && !Number.isFinite(revision)) return respond(400);
        const id = revised ? `${issue.id}-${revision}` : issue.id;
        await env.ISSUE_PLANNER.createBatch([{ id, params: { issueId: issue.id } }]);
      }
      return respond(200);
    } catch {
      console.error('Could not complete Linear intake');
      return respond(503);
    }
  },
};


export class IssuePlanner extends WorkflowEntrypoint {
  async run(event, step) {
    const { issueId } = event.payload;
    return step.do('Plan and publish the latest ticket', {
      timeout: '3 minutes',
      retries: { limit: 4, delay: '30 seconds', backoff: 'exponential' },
    }, async () => {
      const issue = await readIssue(issueId, this.env);
      if (!issue) return { issueId, skipped: true };
      const snapshot = JSON.stringify(issue);
      const proposal = await makePlan(issue, this.env);
      if (snapshot !== JSON.stringify(await readIssue(issueId, this.env))) {
        throw new Error('Ticket changed during planning; retry with current content');
      }
      const id = await postPlan(issueId, proposal, this.env);
      if (snapshot !== JSON.stringify(await readIssue(issueId, this.env))) {
        throw new Error('Ticket changed during publishing; retry with current content');
      }
      console.log(JSON.stringify({ event: 'linear.issue.planned', issueId, commentId: id }));
      return { issueId, commentId: id };
    });
  }
}
