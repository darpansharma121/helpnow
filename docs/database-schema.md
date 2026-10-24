# Database schema

Supabase PostgreSQL schema and security policies are created by `supabase/migrations/20261024190000_helpnow_supabase.sql`. Supabase Auth owns credentials; the application never stores user passwords.

## Tables

- `profiles`: one profile per `auth.users` row, created by a database trigger.
- `helper_preferences`: optional skills, radius, pause state, and availability schedule.
- `help_requests`: request text, category, urgency, lifecycle status, approximate coordinates, and timestamps. Exact location labels are not selectable by application roles.
- `help_assignments`: at most one helper per request, with requester/helper IDs and acceptance timestamp.
- `help_messages`: participant-only chat associated with a request.
- `help_request_reports`: one report per account/request pair to prevent repeated abuse reports.

Requests are readable to authenticated users while open, and to their requester or assigned helper thereafter. Profiles and preferences are owner-scoped. Assignment writes, request lifecycle updates, and reports are not directly granted to authenticated clients; the SQL functions validate the caller and perform those changes atomically. `claim_help_request` locks the request row before checking and creating its unique assignment.

The API rounds coordinates to two decimal places before storing them, does not return location labels, and omits exact contact details. Distance-based matching is not implemented; the feed remains ordered by urgency and recency.
