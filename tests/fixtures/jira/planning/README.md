# Jira planning fixtures

These fixtures document the typed read contract used by backend Tasks 44–47. They are safe, synthetic payloads for wiremock tests and contain no credentials, authorization headers, raw tenant data or custom field IDs.

## Endpoint matrix

| Fixture family | Method/path | Contract |
|---|---|---|
| `projects_page_*.json` | `GET /rest/api/3/project/search?startAt=&maxResults=` | Cloud paginated project results (`values`, `startAt`, `maxResults`, `total`) |
| `boards_page_*.json` | `GET /rest/agile/1.0/board?startAt=&maxResults=` | Cloud paginated board results |
| `sprints_page_*.json` | `GET /rest/agile/1.0/board/{boardId}/sprint?startAt=&maxResults=` | Cloud paginated sprint results with `id`, `name`, `state`, optional dates |
| `sprint_issues_page_*.json` | `GET /rest/agile/1.0/sprint/{sprintId}/issue?startAt=&maxResults=` | Cloud paginated issue reads; fields are retained as untrusted JSON |
| `assignable_users_page_*.json` | `GET /rest/api/3/user/assignable/search?project=&startAt=&maxResults=` | Redacted assignable users: account ID, display name, avatar URL, active flag |
| `fields.json` | `GET /rest/api/3/field` | Visible system/custom field descriptors; no IDs are asserted as application mappings |
| `create_metadata.json` | `GET /rest/api/3/issue/createmeta` (legacy capability fixture only) | Project/issue-type/field metadata shape; current Cloud docs mark this endpoint deprecated |
| `cloud_capabilities.json` | no endpoint | Cloud verified capabilities and move limit 50 |
| `data_center_capabilities.json` | no endpoint | Explicit unknown/unsupported boundary pending selected DC version and probe |
| `permission_denied.json` | any read endpoint | Redacted 403 category |
| `rate_limited.json` | any read endpoint | 429 + Retry-After classification without copying headers into DTOs |
| `write_created.json` | `POST /rest/api/3/issue` | Minimal create response identity (`id`, `key`, `self` ignored by adapter) |
| `write_error_redacted.json` | any write endpoint | Provider error-shaped body used to verify body/header redaction |

Pagination must use the response metadata; clients must not assume one page. A missing or malformed page is an invalid-response failure. The sprint issue endpoint is included because it remains in the current official Agile documentation, while its current page marks it deprecated; the capability flag records this fact.

## Field and subtask rules

`fields.json` and `create_metadata.json` intentionally contain placeholders only. The adapter returns IDs exactly as received when present, but the planning configuration layer must require an explicit user-selected mapping. No `customfield_*` value, story-points name, competency name or subtask issue-type ID is invented by the fixture set.

A remote subtask is identified by Jira's returned issue ID/key and must be linked to its parent only through the returned parent relationship. Creating/updating subtasks and moving issues are write operations outside this fixture set and require the later approval/idempotency path.

## Data Center boundary

Cloud and Data Center base paths/versions are not merged in these fixtures. `data_center_capabilities.json` is a deliberate capability boundary, not a simulated successful response. Enable DC fixtures only after selecting a supported Data Center version and recording an authenticated, read-only probe.
