# API design

Base URL: `/api/v1`. All payloads are JSON. Authentication is planned; the scaffold intentionally exposes demo routes without it.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check |
| `GET` | `/requests` | List active requests; later accepts location and category filters |
| `POST` | `/requests` | Create a help request |
| `GET` | `/requests/:id` | View a request |
| `PATCH` | `/requests/:id/status` | Update request status |
| `POST` | `/requests/:id/accept` | Accept an open request |

## Create request

`POST /api/v1/requests`

```json
{
  "title": "Need O+ blood donor",
  "description": "Required at City Hospital this evening.",
  "category": "medical",
  "urgency": "critical",
  "location": { "latitude": 26.1445, "longitude": 91.7362, "label": "Guwahati" }
}
```

Returns `201 Created` with the normalized request. Invalid input returns `400`; an unknown request returns `404`.

## Socket events

| Event | Direction | Payload |
| --- | --- | --- |
| `request:created` | server → client | New request |
| `request:updated` | server → client | Updated request |
| `request:accepted` | server → client | Accepted request |
