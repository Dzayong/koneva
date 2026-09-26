# API Contract Audit

Audit date: 2026-09-25. Scope: authenticated tenant API under `/api/v1`.

## Result

All UI-required routes are registered behind tenant API-key authentication:

- Tenant: `GET/PATCH /tenant`
- Devices: `GET/POST /devices`, `GET/DELETE /devices/:key`, QR, pause,
  resume, and per-device stats
- Messages: filtered list, detail, send, retry, and broadcast
- Contacts: list, create, detail, update, delete, and CSV import
- Auto reply: paginated list, create, detail, update, toggle, and delete
- Templates: paginated CRUD and render
- Analytics: overview, daily series, and dashboard stats

`GET /messages` supports `device_key`, `status`, `direction`, and `search`.
Search covers content, sender, recipient, and external ID.

## Response contract

Single-resource success:

```json
{ "success": true, "data": {} }
```

Paginated success:

```json
{
  "success": true,
  "data": [],
  "pagination": { "total": 0, "limit": 20, "offset": 0, "has_more": false }
}
```

Error:

```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Readable message" } }
```

Send-message and QR responses retain their previous top-level fields in
addition to `data` for backward compatibility. JSON syntax errors, validation
errors, authentication failures, rate limiting, missing resources, and Device
Manager proxy errors use the standard error envelope.

Public JSON uses snake_case. PostgreSQL timestamps are serialized by Express as
ISO 8601 strings. Numeric aggregates are explicitly converted to JSON numbers.

## Real-time assessment

SSE or WebSocket was not added in this audit because it is optional and would
introduce connection lifecycle, replica fan-out, and ingress timeout concerns.
The current UI can safely poll the list/detail endpoints. A future SSE endpoint
should consume Redis events and support replay IDs so it works across multiple
API Gateway replicas. The existing Redis rule-reload channel is internal and is
not exposed to tenants.

The machine-readable contract is `docs/openapi.yaml`; runnable examples are in
`docs/WA-Gateway.postman_collection.json`.
