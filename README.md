# Shravanam Smriti

> *śravaṇaṁ kīrtanaṁ viṣṇoḥ smaraṇaṁ* — hearing about and remembering Krishna.

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
  - If a session already exists for that day, you choose to **replace** it or **add another session**.
- **Sessions page:** every session can be **replaced** or **deleted**, and there is an activity log.
- **Courses are fully editable after creation:** name, slug, schedule, dates, status (active, paused, archived), timezone, host accounts, the present threshold, the regular threshold and meeting codes. Threshold and host changes apply retroactively.
- **Admin management:** super admins manage everything. Course admins see only the courses assigned to them.
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

Requires Node 22 and Docker.

```bash
npx supabase start          # Postgres, Auth and Mailpit; applies migrations and seed
npx supabase test db        # database tests
cd web
cp .env.example .env.local  # fill in the publishable key printed by `supabase start`
npm install
npm test
npm run dev                 # http://localhost:5173/shravanam-smriti/
```

In development, sign in with an email link. Use `admin@example.com` (super admin) or `guide@example.com` (course admin); the link arrives in Mailpit at http://127.0.0.1:54324.

## Production setup (free)

1. **Supabase:** create a project at supabase.com (free tier).
   - Apply the migrations with `npx supabase link --project-ref <ref>`, then `npx supabase db push`. You can also run the **Apply database migrations** workflow.
   - In the SQL editor, add the first super admin:
     ```sql
     insert into public.admins (email, role) values ('you@gmail.com', 'super_admin');
     ```
   - **Authentication → Providers → Google:** create an OAuth client in Google Cloud Console (type *Web*). Its authorised redirect URI is `https://<ref>.supabase.co/auth/v1/callback`. Paste the client ID and secret into Supabase.
   - **Authentication → URL configuration:** set the Site URL and the redirect allow-list to `https://<user>.github.io/shravanam-smriti/`.
   - **Authentication → Hooks → Before User Created:** choose Postgres function `public.hook_before_user_created`. Recommended.
   - Optionally disable the Email provider so Google is the only sign-in method.
2. **GitHub:**
   - **Settings → Pages → Source:** GitHub Actions.
   - **Settings → Secrets and variables → Actions:**
     - Variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the publishable key). These are public values.
     - Secrets: `SUPABASE_DB_URL` (the connection string, for backups and migrations) and `BACKUP_AGE_PUBLIC_KEY` (`age-keygen` output; keep the private key offline).
   - Push to `main`. The site deploys to `https://<user>.github.io/shravanam-smriti/`.
3. **Keep-alive:** free Supabase projects pause after 7 idle days. `keepalive.yml` calls `ping()` every 3 days.

Restore a backup: download the artifact, run `age -d -i key.txt backup-*.tar.gz.age | tar xz`, then `psql "$DB_URL" -f schema.sql -f data.sql`.

## Security notes

- CSV files never leave the browser. Only normalised rows are sent, and they are validated server-side: at most 2,000 rows, bounded lengths and times.
- Exports neutralise spreadsheet formula injection.
- Production builds ship a Content-Security-Policy that restricts connections to the Supabase URL.
- The `upload_log` table records every create, replace and delete, with the admin's email.
- Session tokens are stored by supabase-js in `localStorage`. The strict CSP and React's escaping protect them from script injection.

## Scaling

The free tier's 500 MB database holds millions of attendance rows; a 50-person daily course adds about 18k rows a year. Queries are indexed by course and time. If usage grows, upgrading to Supabase Pro needs no code changes.
