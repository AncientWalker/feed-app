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
