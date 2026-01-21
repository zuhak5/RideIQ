# RideIQ

A production-minded ride-sharing starter (rider + driver + admin) built on:

- **Frontend:** Vite + React + TypeScript
- **Backend:** Supabase (Postgres + RLS + Edge Functions)
- **Geo:** PostGIS (`geography(Point,4326)` + GiST)
- **Realtime:** Supabase Realtime (Postgres changes with RLS)
- **Wallet:** Top-ups + holds + ledger + withdrawals (QiCard / AsiaPay / ZainCash)

## Local quick start

### 1) Configure web env
Create `apps/web/.env.local`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### 2) Initialize the database
You have two options:

- **Fresh install (recommended):** Run `supabase/schema_fresh.sql` in Supabase SQL Editor (top → bottom).
- **Migrations:** Run the files in `supabase/migrations/` in order.

### 3) Edge Function env (Supabase Dashboard → Project Settings → Functions → Secrets)
Set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended:

- `APP_BASE_URL` (e.g. `http://localhost:5173` in dev, or your GitHub Pages URL in prod)
- `CRON_SECRET` (protects scheduled endpoints)

Payment provider config (top-ups):

- `ZAINCASH_BASE_URL` (defaults to `https://test.zaincash.iq`)
- `ZAINCASH_MERCHANT_ID`
- `ZAINCASH_SECRET`
- `ZAINCASH_MSISDN` (e.g. `9647XXXXXXXXX`)
- `ZAINCASH_LANG` (`en` or `ar`)

### 4) Run

```bash
pnpm install
pnpm dev
```

Open:
- Rider: `http://localhost:5173/rider`
- Driver: `http://localhost:5173/driver`
- Wallet: `http://localhost:5173/wallet`
- Admin Payments: `http://localhost:5173/admin/payments`

---

## Production deploy

### A) Deploy the web app to GitHub Pages
This repo includes `.github/workflows/deploy-pages.yml` (GitHub Actions → Pages) which builds `apps/web` and deploys `apps/web/dist`.

1) GitHub repo → **Settings → Pages** → set **Source** to **GitHub Actions**. (Vite needs a build step.)
2) Add GitHub repo secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

The workflow automatically sets `VITE_BASE=/<repo>/` for GitHub Pages project sites, so routing + assets work under `https://<user>.github.io/<repo>/`.

### B) Deploy Supabase Edge Functions from GitHub Actions
This repo includes `.github/workflows/deploy-supabase-functions.yml` which deploys all functions under `supabase/functions/` on every push to `main`.

Add GitHub repo secrets:
- `SUPABASE_ACCESS_TOKEN` (create in Supabase Dashboard → Account Settings → Access Tokens)
- `SUPABASE_PROJECT_REF` (your project ref, e.g. `ehtimvlmpghstlzvfipx`)

### C) Supabase Auth URLs (required when using GitHub Pages)
Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://<user>.github.io/<repo>/`
- **Additional Redirect URLs:**
  - `https://<user>.github.io/<repo>/*`
  - `http://localhost:5173/*`

---

## Edge Functions in this repo

- `match-ride`
- `driver-accept`
- `ride-transition`
- `topup-create`
- `zaincash-return`
- `asiapay-return`
- `asiapay-notify`
- `qicard-notify`
- `topup-reconcile` (scheduled; requires `CRON_SECRET` header)
- `expire-rides` (scheduled; requires `CRON_SECRET` header)

