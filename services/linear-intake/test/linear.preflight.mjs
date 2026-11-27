import assert from 'node:assert/strict';
import { commentId, postPlan, readIssue } from '../planner.mjs';

const env = process.env;
const issueId = env.LINEAR_TEST_ISSUE_ID;
if (!env.LINEAR_API_KEY || !env.LINEAR_TEAM_ID || !/^[0-9a-f-]{36}$/i.test(issueId ?? '')) {
  throw new Error('Set LINEAR_API_KEY, LINEAR_TEAM_ID, and LINEAR_TEST_ISSUE_ID');
}
const issue = await readIssue(issueId, env);
assert.match(issue?.title ?? '', /synthetic test/i, 'Choose a designated synthetic test issue');
const plan = {
  approach: ['Publish a synthetic plan comment to verify the Linear API contract.'],
  verification: ['Replay and then update the same comment.'],
  priority: 'P3',
  rationale: 'Synthetic integration test only',
  questions: [],
};
const id = commentId(issueId);
assert.equal(await postPlan(issueId, plan, env), id);
assert.equal(await postPlan(issueId, plan, env), id);
assert.equal(await postPlan(issueId, { ...plan, rationale: 'Synthetic preflight update' }, env), id);
console.log('Linear preflight passed: creation, replay, and update used one comment ID.');
