# Deploy Runbook

**Production:** https://lms.kwingsmedia.com · server `164.68.97.187` (shared with other kwingsmedia apps; be careful).

## How a deploy happens

```text
git push origin production
  → GitHub Actions "CI/CD": format, lint, typecheck, build
  → build images ghcr.io/rukshan2000/lms-v2-{api,web}:<git-sha>
  → ssh deploy@164.68.97.187 "<sha> <actor>"   (key can ONLY run deploy.sh)
  → deploy.sh: docker login → compose pull → migrate (new image, owner role) → compose up -d
  → smoke check https://lms.kwingsmedia.com/api/health
```

- `main` and pull requests run checks only. **Only the `production` branch deploys.**
- Release: `git checkout production && git merge --ff-only main && git push`.

## Server layout

| Path | What |
|---|---|
| `/var/www/tuition-lms/docker-compose.yml` | Stack (root-owned, copy of `deploy/docker-compose.yml`) |
| `/var/www/tuition-lms/deploy.sh` | Forced command for the deploy key (root-owned, copy of `deploy/deploy.sh`) |
| `/var/www/tuition-lms/app.env` | API runtime env: `DATABASE_URL` (restricted role) (`root:deploy 640`, never in git) |
| `/var/www/tuition-lms/migrate.env` | `MIGRATION_DATABASE_URL` (owner role), used only by the migration step (`root:deploy 640`) |
| `/var/www/tuition-lms/.env` | `IMAGE_TAG=<sha>` currently running (written by deploy.sh) |
| `/var/www/tuition-lms/deploy.log` | History: `time previous-sha -> new-sha` |
| `/etc/nginx/sites-available/lms.kwingsmedia.com` | `/api/` → 127.0.0.1:4006, rest → 127.0.0.1:3013 |
| `/root/scripts/backup-tuition-lms.sh` + `/etc/cron.d/tuition-lms-backup` | Daily 02:30 `pg_dump`, 14 days, `/root/backups/tuition-lms/` |

Database: host PostgreSQL 16, database `tuition_lms`, roles `tuition_lms_owner` (migrations) and `tuition_lms_app` (runtime). Containers reach it via `host.docker.internal`.

## Migrations

`deploy.sh` runs `node dist/migrate.js latest` in a one-off container of the **new** image before restarting the API. If a migration fails, the deploy stops and the old version keeps running.

Rules:
- Never edit a migration that has reached production. Add a new one.
- Keep migrations compatible with the code that is still running (expand → migrate → contract).
- Manual run on the server: `cd /var/www/tuition-lms && set -a && . ./migrate.env && set +a && docker compose run --rm --no-deps -e MIGRATION_DATABASE_URL api node dist/migrate.js status`

Contract migrations (dropping columns) wait until the code that no longer reads them has been live for at least one release, so a rollback still works. Example: `016_drop_tenant_plan` is kept on the branch `saas-phase5-drop-tenant-plan` until SaaS Phase 1 has been live one release (SAAS_TASKS Phase 5).

## Platform console and billing

Customer accounts, prices, trials, monthly invoices, payments and suspension are run from the platform console at `/admin`, not by SQL. Runbooks: [billing.md](billing.md) (first platform admin, monthly invoices, payments, what customers see) and [plans.md](plans.md) (price books, overrides, features, caps, trials, suspension).

## Changing deploy.sh or docker-compose.yml

They are root-owned on the server on purpose. After changing them in git:
```bash
scp deploy/docker-compose.yml deploy/deploy.sh root@164.68.97.187:/var/www/tuition-lms/
ssh root@164.68.97.187 'chown root:root /var/www/tuition-lms/{docker-compose.yml,deploy.sh} && chmod 755 /var/www/tuition-lms/deploy.sh'
```

## Rollback

Previous images stay on the server. Pick a SHA from `deploy.log`:
```bash
ssh root@164.68.97.187
cd /var/www/tuition-lms
tail deploy.log
echo "IMAGE_TAG=<previous-sha>" > .env && docker compose up -d
```
Then fix forward on `main` and release again. If a migration already ran, roll back only if the old code works with the new schema (expand → contract rule).

## Logs and status

```bash
ssh root@164.68.97.187
cd /var/www/tuition-lms
docker compose ps
docker compose logs -f --tail=100 api
```
Logs rotate at 10 MB × 5 files per container.

## Restore a backup

```bash
ssh root@164.68.97.187
ls -t /root/backups/tuition-lms/
sudo -u postgres pg_restore --clean -d tuition_lms < /root/backups/tuition-lms/<file>.dump
```
Tested 2026-10-16 into a temporary database.

## Rotate the deploy key

1. `ssh-keygen -t ed25519 -N "" -f ~/.ssh/lms_deploy_ed25519`
2. Put the new public key in `/home/deploy/.ssh/authorized_keys` on the server, keeping the `command="/var/www/tuition-lms/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty` prefix.
3. Update GitHub secret `DEPLOY_SSH_KEY` with the new private key.
