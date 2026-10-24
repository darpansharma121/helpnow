# HelpNow

> Real-time local help coordination for urgent community needs.

HelpNow helps community members ask for and offer assistance when time matters. Every account can create requests and accept requests from others; participation is voluntary and there are no permanent requester/helper roles.

## Hackathon MVP

- Create and browse location-aware help requests
- Classify requests by category and urgency
- Browse open requests and track created, accepted, and completed assistance
- Accept a request and update its status in real time
- Create an account and sign in with a password
- Protect the experience with input validation and basic spam checks

## Tech stack

| Area | Technology |
| --- | --- |
| Web client | React, Vite, Tailwind CSS |
| API | Node.js, Express |
| Real-time updates | Socket.IO |
| Database and authentication | Supabase Auth + PostgreSQL with Row Level Security |
| Map | Leaflet + OpenStreetMap |
| AI assistance (optional) | Gemini API, accessed server-side |

## Project layout

```text
helpnow/
├── client/          # React application
├── server/          # Express API and Socket.IO server
├── supabase/        # PostgreSQL schema, RLS policies, and RPC migration
├── docs/            # Product and engineering documentation
├── .env.example     # Server environment-variable template
└── client/.env.example
```

## Getting started

Prerequisites: Node.js 20+ and npm 10+, plus a Supabase project.

### Supabase dashboard setup

1. Create a Supabase project and wait for its database to finish provisioning.
2. In **Project Settings → API**, copy the project URL and the publishable key (or legacy `anon` key). Never copy a `service_role` or secret key into the client.
3. In **SQL Editor**, open and run [`supabase/migrations/20261024190000_helpnow_supabase.sql`](supabase/migrations/20261024190000_helpnow_supabase.sql). It is safe to run again: existing tables/data are retained, and the migration updates its own triggers and policies.
4. In **Authentication → URL Configuration**, set the site URL to `http://localhost:5173` and add that URL to the redirect URLs.
5. In **Authentication → Providers → Email**, enable email/password sign-in. If email confirmation is enabled, new users must confirm their email before signing in.

In PowerShell from the project root:

```powershell
if (-not (Test-Path server\.env)) { Copy-Item .env.example server\.env }
if (-not (Test-Path client\.env)) { Copy-Item client\.env.example client\.env }
Set-Location server
npm install
npm run dev
```

In a second terminal, from the project root:

```powershell
Set-Location client
npm install
npm run dev
```

The client runs on `http://localhost:5173` and the API on `http://localhost:3002` by default.
The Vite development server proxies API and Socket.IO traffic to port 3002 (chosen to avoid common local port conflicts). Replace the placeholders in `server/.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and `client/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) with the dashboard values. Use the same project URL and publishable/anon key in both. `VITE_API_URL=/api/v1` keeps the existing API routing. Set `GEMINI_API_KEY` only in `server/.env` if AI classification is enabled.

The client uses Supabase Auth sessions for sign-up, sign-in, sign-out, and session restoration. The Express API verifies Supabase access tokens and uses the caller's token for database access so RLS remains enforced. Do not configure or expose a Supabase secret/service-role key in the client. Request assignment is performed by the `claim_help_request` PostgreSQL function, which locks the request row and prevents self-claiming or concurrent double assignment.

New users can register in the client; create a second account in another browser or private window to test reciprocal help. The request map and API responses show approximate rather than precise coordinates. Requests are sorted by urgency and recency; helper distance and availability preferences are not currently collected.

For an immediate or life-threatening emergency, contact local emergency services. HelpNow is not emergency dispatch.

## Documentation

- [Vision](docs/vision.md)
- [Problem statement](docs/problem-statement.md)
- [MVP features](docs/features.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/database-schema.md)
- [API design](docs/api-design.md)
- [User flow](docs/user-flow.md)
- [Future roadmap](docs/future-roadmap.md)
- [Technical decisions](docs/decisions.md)

Authenticated API routes and lifecycle details are documented in [API design](docs/api-design.md).

## Contributing

This is a hackathon MVP. Keep changes focused, use conventional commits, and update the corresponding documentation when behaviour changes.

## License

Distributed under the [MIT License](LICENSE).
