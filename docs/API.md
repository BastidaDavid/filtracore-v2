# FiltraCore API Contract

This backend is the only layer the future Xcode app should call. The iOS app should never connect directly to Postgres or use `DATABASE_URL`.

## Base URL

Local development:

```text
http://localhost:3000
```

Render production:

```text
https://filtracore-v2-api.onrender.com
```

Use the production HTTPS URL in Xcode. Render HTTPS works with iOS App Transport Security without adding insecure exceptions.

## Conventions

- Request and response bodies are JSON.
- Field names use camelCase for app clients.
- IDs are integers.
- Date values are returned as ISO strings.
- Mutating endpoints return the full app state so the app can refresh its local UI in one response.
- Current auth: none. Add token-based auth before exposing production customer data.

## Health And Compatibility

### GET `/api/health`

Returns database connectivity status.

```json
{
  "ok": true
}
```

### GET `/api/version`

Returns API compatibility metadata for app startup checks.

```json
{
  "app": "FiltraCore",
  "apiVersion": "1.0",
  "minimumClientVersion": "1.0.0"
}
```

## Full State

### GET `/api/state`

Returns all data needed to render the dashboard.

```json
{
  "machines": [],
  "inventory": [],
  "filters": [],
  "maintenanceRecords": []
}
```

## Machines

### GET `/api/machines`

Returns machines only.

### POST `/api/machines`

Request:

```json
{
  "name": "Ice Machine 1",
  "type": "Ice",
  "location": "Main Bar",
  "department": "Beverage Ops",
  "brand": "Scotsman",
  "model": "HID312A",
  "assetId": "ICE-001"
}
```

Required: `name`, `type`, `location`.

Returns: full app state.

## Inventory

### GET `/api/inventory`

Returns inventory only.

### POST `/api/inventory`

Request:

```json
{
  "name": "Ice Filter Pro",
  "category": "Ice",
  "stock": 5,
  "unitCost": 42.5,
  "reorderLevel": 2,
  "lifeMonths": 6
}
```

Required: `name`, `category`.

Returns: full app state.

## Filters

### GET `/api/filters`

Returns installed filters only.

### POST `/api/filters`

Installs an inventory filter onto a machine and decreases inventory stock by one.

Request:

```json
{
  "machineId": 1,
  "productId": 1,
  "psi": 55,
  "lifeMonths": 6,
  "installedAt": "2026-05-08",
  "dueDate": "2026-11-08"
}
```

Required: `machineId`, `productId`, `lifeMonths`.

Returns: full app state.

### PATCH `/api/filters/:id/psi`

Updates the current PSI and logs a maintenance record.

Request:

```json
{
  "psi": 57
}
```

Returns: full app state.

## Maintenance

### GET `/api/maintenance`

Returns maintenance records only.

### POST `/api/maintenance`

Request:

```json
{
  "machineId": 1,
  "filterId": 1,
  "type": "Warning Review",
  "date": "2026-05-08",
  "notes": "Inspected pressure and corrected PSI.",
  "replacementProductId": null,
  "correctedPsi": 58
}
```

Required: `machineId`, `type`, `date`.

For replacement maintenance, `type` must include `replace`, and `filterId` plus `replacementProductId` are required.

Returns: full app state.

## Deployment Checklist

1. Commit and push `server.js`, `package.json`, `package-lock.json`, `schema.sql`, `script.js`, `.gitignore`, and this `docs/API.md`.
2. In Render, deploy this repository as a **Web Service**, not a Static Site.
3. Set the service start command to `npm start`.
4. Set `DATABASE_URL` on the web service environment.
5. Deploy.
6. Confirm:

If `https://filtracore-v2.onrender.com/server.js` downloads or displays code, that old Render service is still configured as a Static Site. A Static Site cannot run Express API routes.

The API is correctly deployed only when these work:

```bash
curl https://filtracore-v2-api.onrender.com/api/health
curl https://filtracore-v2-api.onrender.com/api/version
curl https://filtracore-v2-api.onrender.com/api/state
```

Expected health response:

```json
{"ok":true}
```

Do not put `DATABASE_URL` in Xcode or the browser. It belongs only in the Render Web Service environment.
