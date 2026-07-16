# Database schema

The first backend scaffold uses in-memory data for a fast demo. The production-shaped MongoDB model below is the source of truth for the next implementation step.

## User

```text
_id, name, email, avatarUrl, phoneVerified,
skills[], reliabilityScore, createdAt, updatedAt
```

## HelpRequest

```text
_id, requesterId, helperId,
title, description, category, urgency, status,
location { type: "Point", coordinates: [longitude, latitude], label },
attachments[], aiSummary, reportCount,
createdAt, acceptedAt, resolvedAt, updatedAt
```

`location` will have a `2dsphere` index for nearby queries. Only an approximate location is returned in public request views.

## Notification (planned)

```text
_id, userId, type, requestId, readAt, createdAt
```

## AuditEvent (planned)

```text
_id, actorId, entityType, entityId, action, metadata, createdAt
```
