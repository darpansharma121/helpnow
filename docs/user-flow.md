# User flow

```mermaid
flowchart TD
  A[Open HelpNow] --> B[Sign in or create account]
  B --> C{Need help or want to help?}
  C -->|Need help| D[Enter request details]
  D --> E[Confirm approximate location]
  E --> F[Publish request]
  F --> G[Other members browse open requests]
  G --> H[One member atomically accepts]
  H --> I[Requester sees acceptance]
  I --> J[Start assistance and mark complete]
  C -->|Want to help| G
  J --> K[Same account can create another request]
```

Each member uses one account for requesting and helping. Exact location data is not shown publicly; the current app does not measure helper distance or availability. For immediate danger, contact local emergency services.
