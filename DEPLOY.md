# Deploying HCE Trainer to a Hetzner box

One Node process serves everything: the built frontend, the SQLite-backed API,
and the Anthropic proxy. The Anthropic API key lives only in an environment
variable on the server — it is never entered into, stored in, or sent from a
browser.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For AI features | Used server-side for question generation and essay grading. Without it, practice/mock tests still work; AI features show a clear "not configured" message. |
| `APP_PASSWORD` | Recommended | If set, every request requires HTTP basic auth (any username, this password). Leave unset for local dev. |
| `PORT` | No | Defaults to `3001`. |

Use a key from a dedicated workspace in the Anthropic Console with a monthly
spend limit, so a leak or runaway usage is capped.

## Server setup (Ubuntu/Debian)

The live box runs the app from **`/home/deploy/hce-trainer`** as the **`deploy`**
user (a regular login user with NOPASSWD sudo), reachable over Tailscale at
`ssh deploy@hce-trainer`. The original `/opt/hce-trainer/app` + `hce`-user layout
below is the hardened ideal; the paths in the "Updating" section reflect what is
actually deployed.

```bash
# 1. Node 22+ (must match the box — better-sqlite3 compiles natively here)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# 2. App
git clone <your-repo-url> /home/deploy/hce-trainer
cd /home/deploy/hce-trainer
npm ci          # do NOT copy node_modules from your Mac
npm run build
```

## systemd unit

`/etc/systemd/system/hce-trainer.service`:

```ini
[Unit]
Description=HCE Trainer
After=network.target

[Service]
User=deploy
WorkingDirectory=/home/deploy/hce-trainer
ExecStart=/usr/bin/npx tsx server/index.ts
Restart=on-failure
# Put real values in this file, chmod 600, owned by root:
EnvironmentFile=/etc/hce-trainer.env

[Install]
WantedBy=multi-user.target
```

`/etc/hce-trainer.env` (then `sudo chmod 600 /etc/hce-trainer.env`):

```
ANTHROPIC_API_KEY=sk-ant-api03-...
APP_PASSWORD=pick-a-good-password
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hce-trainer
```

## HTTPS reverse proxy (Caddy) + firewall

HTTPS is required: the basic-auth password rides on every request. Caddy gets
certificates automatically. `/etc/caddy/Caddyfile`:

```
trainer.yourdomain.example {
    reverse_proxy localhost:3001
}
```

Only expose 80/443 — the app port stays internal:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable        # 3001 is NOT exposed
```

(Or use the Hetzner Cloud firewall with the same rules.)

## Data & backups

Everything lives in `data/hce_trainer.db` (questions, mock runs, per-profile
progress). The box has **no `sqlite3` CLI**, so take a consistent snapshot with
better-sqlite3's `.backup()` (a plain `cp` of a live WAL database can be torn):

```bash
cd /home/deploy/hce-trainer
BK=~/hce_trainer.backup-$(date +%F).db node -e '
  const D = require("/home/deploy/hce-trainer/node_modules/better-sqlite3");
  new D("data/hce_trainer.db", { readonly: true }).backup(process.env.BK)
    .then(() => console.log("backup ->", process.env.BK));'
# or just: tar czf ~/hce-data-backup-$(date +%F).tgz data/
```

## Updating

The DB is git-tracked but the live box keeps its working tree clean (the DB is
effectively skip-worktree), so a **code-only** `git pull --ff-only` does NOT
touch `data/hce_trainer.db` — no data-protection dance needed. `npm ci` is only
required when dependencies change; for a code-only change, `npm run build` +
restart is enough (the server runs `npx tsx server/index.ts`, so the new
`server/index.ts` is picked up on restart; the frontend needs the rebuild).

```bash
ssh deploy@hce-trainer
cd /home/deploy/hce-trainer
# back up first (see "Data & backups" above)
git pull --ff-only origin main
npm run build                      # add `npm ci &&` first if deps changed
sudo systemctl restart hce-trainer
systemctl is-active hce-trainer    # expect: active
```

Never `git pull` the DB onto the box, and deploy question-bank changes only via
`scripts/sync-questions-to-server.mjs` (it touches the questions table only,
never user progress).
