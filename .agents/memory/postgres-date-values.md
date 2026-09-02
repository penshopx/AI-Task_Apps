---
name: PostgreSQL date values
description: The Node PostgreSQL driver may expose DATE columns as Date objects depending on runtime configuration.
---

Normalize PostgreSQL `DATE` values to an ISO `YYYY-MM-DD` string at the server boundary before serializing API responses or applying client-side date filters.

**Why:** A date-only database field can arrive as a JavaScript `Date` or a driver-formatted string; passing the raw value through can produce invalid browser dates and stop rendering.

**How to apply:** Convert `Date` instances with `toISOString().slice(0, 10)` and validate string dates before formatting, comparing, or persisting them.