# Score submissions and screenshot storage

Submissions are stored as pending in D1. Screenshot files are kept privately in the R2 bucket `game-score-submissions-images`. The Worker tracks used and in-flight image bytes in D1 and reserves space before an upload, stopping new uploads once the app-managed total reaches 8,000,000,000 bytes (8 GB). Each image is limited to 5 MB and must be PNG, JPG, or WebP.

## Apply the storage migration and deploy

The R2 binding is configured in `wrangler.jsonc` to use the bucket `game-score-submissions-images`. Make sure that exact bucket exists in the same Cloudflare account. Then apply the migration and deploy:

```powershell
npm.cmd exec -- wrangler d1 migrations apply DB --remote
npm.cmd run deploy
```

## Review incoming submissions

In the Cloudflare D1 Console, run:

```sql
SELECT id, game, player_name, score, submitted_at, image_key, image_bytes
FROM score_submissions
WHERE status = 'pending'
ORDER BY submitted_at DESC;
```

Find each screenshot using its `image_key` in the private R2 bucket. The usage counter is available with:

```sql
SELECT used_bytes, reserved_bytes, 8000000000 - used_bytes - reserved_bytes AS bytes_remaining
FROM score_image_storage
WHERE id = 1;
```

After reviewing a score and its screenshot, mark the record approved in D1. For example, replace `123` with the submission ID:

```sql
UPDATE score_submissions SET status = 'approved' WHERE id = 123 AND status = 'pending';
```

The public leaderboard reads approved records directly from D1 through `GET /api/leaderboard`. Open leaderboard pages refresh about once a minute (and when returning to the tab), so an approved score appears automatically without editing or deploying a generated scores file. Deploy the Worker changes once with `npm.cmd run deploy` to enable the live endpoint.
