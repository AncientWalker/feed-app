# Linear issue intake

The Worker receives Linear issue-created events for the configured team and stores the ticket snapshot in D1. The issue UUID is the primary key, so retries do not duplicate intake. Linear receives HTTP 200 only after a successful write or when the event is out of scope. Storage errors return 503 so Linear can retry.

## Deploy and verify

1. In the target Cloudflare account, run `npx wrangler d1 create linear-issue-intake` and place the returned database ID in `wrangler.toml`.
2. Run `npx wrangler d1 migrations apply INTAKE --remote` and `npx wrangler deploy`.
3. In Linear workspace API settings, create a webhook for the configured team with the **Issues** resource and the deployed HTTPS URL ending in `/webhooks/linear`. Set its signing secret on the Worker with `npx wrangler secret put LINEAR_WEBHOOK_SECRET`. Set the team UUID with `npx wrangler secret put LINEAR_TEAM_ID`. Keep deployment credentials out of Git.
4. Create an approved verification issue in the configured team and confirm exactly one row appears. Replay the delivery or send a second signed copy and check that the count stays at one. Edits should produce no new row.
5. Pause the hourly Codex automation once the live receipt is confirmed.

Inspect recent receipts using:

```sh
npx wrangler d1 execute INTAKE --remote --command 'SELECT identifier, issue_url, received_at FROM issue_intake ORDER BY received_at DESC LIMIT 20'
```

[Linear webhook setup and signing](https://linear.app/developers/webhooks)

## Enable planning

After deploying the Workflow binding, add two Worker secrets in Cloudflare:

- `OPENAI_API_KEY` for the planning model. The default is `gpt-5-mini`. Set `PLANNING_MODEL` to another Responses API model with structured output if needed.
- `LINEAR_API_KEY` with access to the configured team and permission to read, create, and update its own planning comments. Scope this key to the configured team. The Worker uses a Linear personal API key in the Authorization header.

The worker sends new issue titles and descriptions to the planning API. Keep credentials and confidential material out of ticket descriptions used for planning. Set both secrets before creating the verification issue. When either secret is absent, intake continues to record issues. Planning runs for new issues and title or description edits. Edits refresh the existing planning comment. Priority, label, and status changes do not trigger planning. Existing issues are processed when their title or description is next edited.

Create a new issue and check the `linear-issue-planner` Workflow instance and the resulting comment in Linear. Send the same signed issue-created delivery twice and confirm only one comment exists. Priority and workflow state are controlled in Linear by the project owner.

## Test before deployment

From `services/linear-intake` with Node.js 22 or later:

- Run `node --test test/planner.test.mjs` for deterministic IDs, duplicate handling, comment updates, and error reporting. This suite uses mocked responses.
- Run `node test/linear.preflight.mjs` with `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, and `LINEAR_TEST_ISSUE_ID` set in your environment to exercise the real Linear comment API using the candidate code. Use the issue UUID for a designated issue with “synthetic test” in its title. The preflight writes and updates one synthetic planner comment on that issue. It does not use OpenAI or deploy a Worker.
