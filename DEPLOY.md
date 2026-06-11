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

```bash
# 1. Node 22+ (must match the box — better-sqlite3 compiles natively here)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# 2. App
sudo useradd -r -m -d /opt/hce-trainer -s /usr/sbin/nologin hce
sudo -u hce git clone <your-repo-url> /opt/hce-trainer/app
cd /opt/hce-trainer/app
sudo -u hce npm ci          # do NOT copy node_modules from your Mac
sudo -u hce npm run build
```

## systemd unit

`/etc/systemd/system/hce-trainer.service`:

```ini
[Unit]
Description=HCE Trainer
After=network.target

[Service]
User=hce
WorkingDirectory=/opt/hce-trainer/app
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

Everything lives in `data/hce_trainer.db` (questions, mock runs). Back it up
with `sqlite3 data/hce_trainer.db ".backup /backup/hce_$(date +%F).db"` — a
plain `cp` of a live WAL database can produce a torn copy.

## Updating

```bash
cd /opt/hce-trainer/app
sudo -u hce git pull
sudo -u hce npm ci && sudo -u hce npm run build
sudo systemctl restart hce-trainer
```
