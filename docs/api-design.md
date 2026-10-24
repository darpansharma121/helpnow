# API design

Base URL: `/api/v1`. All payloads are JSON. Request routes require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check |
| `GET` | `/requests` | List open requests plus the current user's requests and accepted assistance |
| `POST` | `/requests` | Create a request as the authenticated user |
| `POST` | `/requests/:id/accept` | Atomically accept an open request |
| `PATCH` | `/requests/:id/status` | Perform an authorized lifecycle transition |
| `POST` | `/requests/:id/report` | Report a request |
| `POST` | `/requests/analyze-ai` | Analyze draft text; suggestions are not published automatically |

Email/password registration, sign-in, sign-out, and session restoration use the Supabase Auth client directly. The API verifies the bearer access token with Supabase Auth. The auth trigger creates the corresponding profile and helper-preference row.

## Create request

`POST /api/v1/requests`

```json
{
  "title": "Need O+ blood donor",
  "description": "Required at the hospital this evening.",
  "category": "medical",
  "urgency": "critical",
  "location": { "lat": 26.1445, "lng": 91.7362, "label": "Guwahati" }
}
```

The authenticated account determines `requesterId` and `requesterName`; the database trigger also resolves the name from the caller's profile. Coordinates are rounded to two decimal places before persistence, and exact location labels cannot be selected by authenticated clients. Returns `201 Created` with the normalized request. Invalid input returns `400`; unauthenticated requests return `401`.

Public request responses round coordinates to two decimal places, return only the generic `Approximate area` label, and omit phone/contact details. Exact coordinates remain in the stored request because the current map pin is used for request placement.

## Request lifecycle and authorization

```text
OPEN → ACCEPTED → IN_PROGRESS → RESOLVED
  ├──────────────→ CANCELLED (requester)
  └──────────────→ UNFULFILLED (requester, if still open)
ACCEPTED / IN_PROGRESS → OPEN (assigned helper releases)
```

Only a non-requester may accept an open request. The `claim_help_request` PostgreSQL function takes a row lock and inserts the unique assignment in the same transaction, so simultaneous claims yield one success and a `409` for the other helper. `transition_help_request` enforces lifecycle ownership and transitions inside PostgreSQL. Only the assigned helper can start work or release it; the requester or assigned helper can complete in-progress work. Only the requester can cancel or close an open request as unfulfilled. Invalid ownership returns `403`; invalid or concurrent transitions return `409`.

The socket server requires the same bearer token. Chat events are restricted to the requester and assigned helper; client-supplied sender IDs are ignored.
Three abuse reports flag a request, removing it from discovery.

## Socket events

| Event | Direction | Payload |
| --- | --- | --- |
| `request:created` | server → client | New request |
| `request:updated` | server → client | Updated request |
| `chat:message` | server → client | Message visible only in a participant room |
