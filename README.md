# Shravanam Smriti

> *śravaṇaṁ kīrtanaṁ viṣṇoḥ smaraṇaṁ* - hearing about and remembering Krishna.

An attendance dashboard for devotional study sessions (Bhagavad Gita, Srimad Bhagavatam and so on) held on Google Meet. It shows who comes, how often, for how long, and who might need a gentle call. It supports any number of courses and is visible to admins only. It runs for **$0**: GitHub Pages hosts the frontend and the Supabase free tier is the backend.

## Features

- **Course dashboard:**
  - sessions, unique devotees, average headcount, average time in call, regulars
  - interactive charts: attendance per session (click a bar to filter), average minutes, month by month, a devotee × session heatmap, time-in-call and joining-time distributions, weekday pattern
  - filters that live in the URL, so links are shareable: period, "counts as present" threshold, minimum sessions, minimum streak, segment (Regular / Occasional / New / Lapsed), name search
  - a sortable leaderboard with CSV export
- **Devotee profile:** session timeline (bars or line), streaks, milestones (1, 10, 25, 50, 108…), monthly breakdown, and a consistency signal.
- **Upload:**
  - Drop one or many Meet attendance CSVs. They are **parsed in the browser**; only names, join times and minutes are sent, and the file itself is never uploaded or stored.
  - The course is detected automatically from the meeting code.
  - Host accounts are excluded, and look-alike names are suggested as "same person?".
  - A course can have **several sessions a day** (for example a morning and an evening class). Uploads are matched by time: a file at a new time becomes a separate session, and sessions within a day are numbered by start time.
  - If a file overlaps a session that's already uploaded, you choose to **replace** it, **keep both**, or skip the file.
- **Sessions page:** every session can be **replaced** or **deleted**, and there is an activity log.
- **Courses are fully editable after creation:** name, slug, schedule, dates, status (active, paused, archived), timezone, host accounts, the present threshold, the regular threshold and meeting codes. Threshold and host changes apply retroactively.
- **Users & access:** super admins grant, change and remove access in the app (by Google email, per course), see who has signed in, handle access requests, and review an audit log. Course admins see only their courses.
- **Name clean-up:** rename devotees and merge duplicates. A merged spelling becomes an alias, so future uploads match it.
- **Light and dark themes**, a CVD-validated chart palette, and keyboard-accessible controls.

## Architecture

```
GitHub Pages (static React SPA)  ──supabase-js (public key + user JWT)──▶  Supabase (free tier)
 ├─ Google sign-in                                                          ├─ Auth (Google)
 ├─ CSV parsed locally → preview → ingest RPC                              ├─ Postgres + Row-Level Security
 └─ ECharts dashboards                                                      └─ SQL RPCs (analytics + writes)
GitHub Actions: CI · Pages deploy · keep-alive ping · encrypted weekly backup · manual migrations
```

There is **no application server**. Postgres enforces authorization:

- RLS is enabled on every table, and the `authenticated` role can only `SELECT` rows it is allowed to see.
- Every write goes through a `SECURITY DEFINER` RPC that checks the caller's role. Direct inserts, updates and deletes are revoked.
- Admins are identified by the **verified email** in `auth.users`. They are listed in `admins` (`super_admin` / `course_admin`) and, for course admins, in `course_admins`.
- The optional **sign-up hook** (`hook_before_user_created`) rejects any email that is not an admin, so strangers never even get an account.
- The frontend's public key is public by design. The service-role key is never used by the app.

Analytics run in SQL. A single `course_dashboard()` call returns everything a page needs: per-session stats, per-devotee stats (streaks via gaps-and-islands, segments) and a compact attendance matrix. The browser then cross-filters it instantly. Results are `jsonb`, so large courses are not cut off by the API row limit.

| Path | What |
|---|---|
| `supabase/migrations/` | Schema, RLS, write RPCs, analytics RPCs, sign-up hook |
| `supabase/tests/` | pgTAP tests: RLS isolation, ingest/replace/delete, host exclusion, streak maths |
| `supabase/seed.sql` | Synthetic demo data for local development |
| `web/src/lib/parseMeetCsv.ts` | Meet CSV parser (unit tested) |
| `web/src/features/` | Pages: overview, course, participant, upload, admin |
| `.github/workflows/` | CI, deploy, keep-alive, backup, migrate |

## Local development

Requires Docker (running), Node 22 and `make`.

```bash
make dev      # starts local Supabase, writes web/.env.local, installs deps, opens the app
```

On the login page, use the **Quick sign-in** buttons. They appear only in local dev and sign in as the seeded demo accounts (password `hare-krishna`, local only):

| Button | Account | Sees |
|---|---|---|
| Super admin | `admin@example.com` | everything |
| Course admin | `guide@example.com` | only the weekend course |
| No access | `visitor@example.com` | the "no access" screen |

Other targets (`make help` lists them all):

| Command | What it does |
|---|---|
| `make test` | frontend unit tests + database (pgTAP) tests |
| `make check` | typecheck, lint, tests and build: everything CI runs |
| `make db-reset` | recreate the local database from migrations + demo seed |
| `make studio` / `make mail` | open the local database UI / email inbox |
| `make db-stop` | stop the Docker containers |

Without `make`: run `npx supabase start`, copy `web/.env.example` to `web/.env.local` with the printed publishable key, then run `npm install && npm run dev` in `web/`.

## Production setup (free)

Placeholders used below. Replace them with your own values; none of them are secrets except where noted.

| Placeholder | Example | Where it comes from |
|---|---|---|
| `<owner>` / `<repo>` | `my-org` / `shravanam-smriti` | your GitHub repository |
| `<site-url>` | `https://<owner>.github.io/<repo>/` | GitHub Pages address (keep the trailing `/`) |
| `<project-ref>` | `abcdefghijklmnop` | the part before `.supabase.co` in your Supabase project URL |

**Never commit or paste into issues:** the Google OAuth client secret, the Supabase `service_role` / secret keys, the database password or connection string, and the backup private key. The Supabase URL and publishable (anon) key are public by design; row-level security protects the data.

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard) on the free plan. Pick a region close to your users, and store the database password in a password manager.
2. Apply the database schema from this repo (no Docker needed):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # migrations only; the local demo seed is never pushed
   ```
   Later changes can also be applied with the **Apply database migrations** workflow (needs the `SUPABASE_DB_URL` secret, step 5).
3. Add yourself as the first super admin in **SQL Editor** (use the Google account you will sign in with):
   ```sql
   insert into public.admins (email, role) values ('<your-google-email>', 'super_admin');
   ```
   After that, manage everyone else from the app's **Users** page (see [Managing users](#managing-users)).

### 2. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com), select or create a project.
2. **APIs & Services → OAuth consent screen:** choose *External*, fill in the app name, support email and developer email. You can leave it in *Testing* and list each admin under **Test users**; only admins sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*:
   - Authorized JavaScript origins: `https://<owner>.github.io`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Copy the client ID and client secret. The secret goes **only** into the Supabase dashboard (next step).
5. In Supabase, **Authentication → Sign In / Providers → Google:** enable it, paste the client ID and secret, and save. Until this is done, sign-in fails with "Unsupported provider: provider is not enabled".
6. **Authentication → URL Configuration:**
   - Site URL: `<site-url>`
   - Redirect URLs: add `<site-url>`. For local testing with Google, also add `http://localhost:5173/shravanam-smriti/`.
7. Optional: disable the Email provider so Google is the only way to sign in.

### 3. Block sign-ups from non-admins (recommended)

After step 1.3 (so you don't lock yourself out): **Authentication → Hooks → Before User Created →** type *Postgres*, schema `public`, function `hook_before_user_created`. Emails that aren't on the admin list can then no longer create an account at all. Without the hook they can sign in but see nothing, and appear under **Waiting for access** on the Users page.

### 4. GitHub Pages and variables

1. **Settings → Pages → Build and deployment → Source:** *GitHub Actions*. (With "Deploy from a branch", Pages publishes the repository files instead of the app, and the deploy workflow fails with a 404.)
2. **Settings → Secrets and variables → Actions → Variables** (public values):
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY` = the **publishable** key from Supabase **Project Settings → API Keys**. Never use a secret or `service_role` key here.
3. Run the **Deploy to GitHub Pages** workflow (or push to `main`). The site is served at `<site-url>`.

### 5. Backups and one-click migrations (optional)

Add these as **Actions secrets** (not variables):
- `SUPABASE_DB_URL`: from the dashboard's **Connect** button, the **Session pooler** connection string with your database password filled in. (The direct connection is IPv6-only and GitHub runners can't reach it.)
- `BACKUP_AGE_PUBLIC_KEY`: run `age-keygen -o backup-key.txt` locally and use the `age1…` public key. Keep `backup-key.txt` offline; it's the only way to decrypt backups.

The **Encrypted database backup** workflow then runs weekly. To restore: download the artifact, run `age -d -i backup-key.txt backup-*.tar.gz.age | tar xz`, then `psql "<connection-string>" -f schema.sql -f data.sql`.

### 6. Keep-alive

Free Supabase projects pause after 7 idle days. `keepalive.yml` calls the public `ping()` function every 3 days using the two variables above; nothing else is needed.

## Managing users

Super admins manage access from **Users** in the app. Nobody needs database access after the first super admin is added.

- **Give someone access:** enter their Google account email and pick a role.
  - **Course admin:** sees, uploads to and edits only the courses you tick.
  - **Super admin:** everything, including this page and deleting courses. Asks for confirmation.
  - Nothing is emailed. Share the site link shown after granting, and they sign in with that Google account.
- **People with access:** each person shows *Invited* (hasn't signed in yet) or *Active* with their last sign-in date. Change roles, tick or untick courses, or remove access. Removing someone takes effect immediately; their past uploads stay.
- **Waiting for access:** people who signed in but have no access (only when the sign-up hook is off). Grant access or dismiss them.
- **Recent changes:** every grant, role change, course change and removal, with who made it and when.

Guard rails: you can't demote or remove yourself, so there is always at least one super admin, and every change is checked by the database, not just the page.

## Security notes

- CSV files never leave the browser. Only normalised rows are sent, and they are validated server-side: at most 2,000 rows, bounded lengths and times.
- Exports neutralise spreadsheet formula injection.
- Production builds ship a Content-Security-Policy that restricts connections to the Supabase URL.
- The `upload_log` table records every create, replace and delete, with the admin's email.
- Session tokens are stored by supabase-js in `localStorage`. The strict CSP and React's escaping protect them from script injection.

## Scaling

The free tier's 500 MB database holds millions of attendance rows; a 50-person daily course adds about 18k rows a year. Queries are indexed by course and time. If usage grows, upgrading to Supabase Pro needs no code changes.
