# Features

## Included in the hackathon MVP

| Feature | Description |
| --- | --- |
| Reciprocal accounts | Every signed-in member can create requests and offer assistance using the same account. |
| Help request creation | Capture title, description, category, urgency, and approximate location. Voice dictation can prefill a draft where browser speech recognition is available. |
| Request discovery | Browse open requests in a filterable feed and map view; sort by urgency then recency. |
| Request lifecycle | Open, accepted, in-progress, resolved, cancelled, and requester-closed-as-unfulfilled states with server-side ownership checks. |
| Helper acceptance | An authenticated member can claim an open request; a conditional database update prevents duplicate claims. |
| Real-time updates | New and updated requests appear without refreshing. |
| Basic safety controls | Password hashing, signed access tokens, authorization checks, request validation, approximate public locations, and abuse reports. |

The application does not currently collect helper location, distance radius, skills, availability schedules, or verified identity. Do not interpret the feed as distance-based matching or accounts as verified. Voice draft transcription depends on browser support and may be processed by the browser's speech service; review the transcript and AI suggestions before publishing.

## Explicitly out of scope for the MVP

- Medical or emergency dispatch
- Payments and service pricing
- Full background verification
- Voice calling, payments, or service pricing
- Government/NGO integrations

## AI-assisted enhancements

If an API key is available, AI can suggest a category and urgency from the request text, create a short helper-facing summary, and flag likely spam. Human-visible request content remains editable; AI never makes emergency decisions.
