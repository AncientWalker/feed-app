import assert from 'node:assert/strict';
import test from 'node:test';
import { commentId, postPlan } from '../planner.mjs';

const issueId = 'aa9fd8db-0770-4ee8-9a3d-eff430e63362';
const env = { LINEAR_API_KEY: 'synthetic-key' };
const plan = { approach: ['Add a loading state'], verification: ['Check keyboard access'],
  priority: 'P2', rationale: 'Routine improvement', questions: [] };

test('comment ID reuses the stable Linear issue UUIDv4', () => {
  assert.equal(commentId(issueId), issueId);
  assert.notEqual(commentId(issueId), commentId('19e602d7-1c52-4d02-97e5-a2dee0e4cb3b'));
  assert.throws(() => commentId('SAH-20'), /UUIDv4/);
});

test('create, replay, and replan retain a single comment ID', async t => {
  let comment;
  let updates = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('PostPlan')) {
      assert.equal(variables.input.issueId, issueId);
      assert.match(variables.input.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      if (comment) return Response.json({ errors: [{ message: 'Comment already exists' }] });
      comment = { ...variables.input, issue: { id: issueId } };
      return Response.json({ data: { commentCreate: { success: true, comment } } });
    }
    assert.equal(variables.id, comment.id);
    if (query.includes('ExistingPlan')) return Response.json({ data: { comment } });
    assert.match(query, /UpdatePlan/);
    comment.body = variables.input.body;
    updates++;
    return Response.json({ data: { commentUpdate: { success: true, comment } } });
  });
  const id = await postPlan(issueId, plan, env);
  assert.equal(await postPlan(issueId, plan, env), id);
  assert.equal(await postPlan(issueId, { ...plan, rationale: 'Updated requirements' }, env), id);
  assert.equal(updates, 1);
  assert.match(comment.body, /Updated requirements/);
});

test('Linear input rejection survives the recovery lookup', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query } = JSON.parse(options.body);
    if (query.includes('PostPlan')) {
      return Response.json({ errors: [{ message: 'Input validation failed for internal content',
        extensions: { code: 'INVALID_INPUT', validationErrors: [{ property: 'id' }] } }] });
    }
    return Response.json({ errors: [{ message: 'Resource not found' }] });
  });
  await assert.rejects(postPlan(issueId, plan, env), error =>
    /commentCreate.*INVALID_INPUT.*field: id/.test(error.message) && !error.message.includes('internal content'));
});
