# Fynix Sales

Lead assignment and follow-up for sales teams. Superadmins import lead lists, create workspaces and invite people. Salespeople claim leads per workspace and work them through stages, follow-ups and notes.

## Concepts

- **Category**: Scale (premium businesses) or Reach (local businesses). Each has its own workspaces, lists and salespeople. Nothing crosses between them.
- **Workspace**: a service a team sells (Website, SEO, Social Media, iDraft, ...). A lead is claimed per workspace, so the same business stays visible in the other workspaces.
- **Roles**: `superadmin` sees and manages everything. `sales` is locked to one category and only sees its own workspaces. Salespeople never see who claimed what.

## Run it locally

Needs Node 24 or newer.

```bash
npm install
cp .env.example .env
npm run seed     # demo accounts, workspaces and lead lists
npm run dev      # http://127.0.0.1:3000
```

Demo accounts use the `@fynix.test` domain: `aarav` and `meera` (superadmins), `priya` and `rohan` (Scale), `aisha` and `karan` (Reach). They all share the `SEED_PASSWORD` from your `.env`.

## Email (optional)

Set `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL` in your own `.env` to email invite links through Resend. Without them the superadmin copies the one-time invite link from the screen and sends it themselves. Invite links work once and expire after 7 days; `npm run create-admin -- <email> <name>` prints one for a new superadmin.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the server with reload |
| `npm test` | API integration tests (in-memory database) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` / `npm start` | Compile to `dist/` and run it |

## Layout

- `src/` server: `app.ts` (hooks, pages), `routes/` (auth, sales, admin), `importer.ts` (CSV cleaning), `mailer.ts`, `schema.ts` (SQLite)
- `web/` front end: `login.html`, `sales.html`, `admin.html`, `assets/`
- `seed/` sample lead data

## Notes

- Data lives in PostgreSQL (`DATABASE_URL`); tables are created by the migrations in `drizzle/` when the server starts. Tests use an in-memory Postgres (PGlite), so they need no database. Set `NODE_ENV=production` behind HTTPS so cookies are marked Secure.
- Sessions are stored server side and sent as an HttpOnly cookie. Sign-in attempts are rate limited per address and client.
