# ADR-0005: Jira planning workspace contract

- **Status:** accepted for backend Tasks 44–47
- **Date checked:** 2026-09-05 (MSK)
- **Scope:** project/board/sprint/user/field metadata and read contracts; no planning UI or remote planning writes

## Decision

The first adapter exposes a **Cloud-verified** Jira contract and keeps Data Center support explicit but unverified. The deployment is selected by `JiraDeployment` (`cloud` or `data_center`); the client never silently treats a Data Center response as a Cloud response. Until a target Data Center version and authenticated instance are available, Data Center capability flags remain `false`/`unknown` and fixture coverage is contract-shaped only.

All planning metadata is fetched through the Rust core. DTOs contain identifiers, display metadata, capability status and redacted error categories only; they never contain access tokens, credential references, authorization headers or raw response bodies.

Custom field IDs are **configuration data returned by Jira**, not constants. The adapter returns field IDs and schema metadata from `/rest/api/3/field` and project/issue-type create metadata. It does not infer or invent a story-points or competency field. A managed project is invalid for planning until the user selects verified mappings and a subtask issue type from returned metadata.

## Official contract review

The following current official pages were re-read on 2026-09-05:

- [Jira Cloud REST v3 intro](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [Project APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/) — `GET /rest/api/3/project/search` is paginated and returns projects visible to the caller; visibility depends on Jira project permissions.
- [Jira Software board APIs](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/) — `GET /rest/agile/1.0/board` and `GET /rest/agile/1.0/board/{boardId}/sprint` are paginated and permission-filtered.
- [Jira Software sprint APIs](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/) — `GET /rest/agile/1.0/sprint/{sprintId}/issue` is paginated and permission-filtered; the current page marks this operation deprecated, so the adapter records that capability and does not promise a replacement without a verified contract. The move operation accepts issue IDs/keys, only open or active sprints, and documents a maximum of 50 issues per operation.
- [User search APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-user-search/) — `GET /rest/api/3/user/assignable/search` returns users assignable to a project/issue; the adapter keeps account ID, display name and avatar URL only.
- [Issue field APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/) — `GET /rest/api/3/field` returns visible system/custom fields. The page states that field visibility depends on configuration/screens/permissions.
- [Issue APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/) — `POST /rest/api/3/issue` creates issues and accepts a `parent` relationship for subtasks when the returned create metadata permits it; `PUT /rest/api/3/issue/{issueIdOrKey}` updates issues. The older `/rest/api/3/issue/createmeta` endpoint is marked deprecated in the current Cloud docs; this backend treats it as an explicit capability boundary rather than guessing a successor.
- [Jira Data Center REST introduction](https://developer.atlassian.com/server/jira/platform/rest/v2/intro/) — official Server/DC documentation is versioned separately; this repository has no selected DC version or authenticated contract fixture, so DC planning capabilities remain unverified.

The Cloud page also exposes OAuth scope requirements. Basic-auth/API-token and OAuth details remain an integration concern and are intentionally absent from planning DTOs. At minimum, read operations need project/board/sprint/work/user scopes and remote move/create/update operations need the corresponding write permissions; exact installation-specific permission failures are returned as redacted categories.

## Capability matrix

| Operation | Cloud | Data Center | Boundary |
|---|---:|---:|---|
| Paginated project search | verified | unknown | DC version/shape must be probed before enabling |
| Paginated board discovery | verified | unknown | Agile REST is separately versioned |
| Paginated board sprint discovery | verified | unknown | board permission filtering is remote |
| Sprint issue read | verified, current docs mark endpoint deprecated | unknown | keep endpoint capability explicit; no guessed replacement |
| Move issues to sprint | verified; max 50/request; open/active target only | unknown | chunking is a later write task, not implemented here |
| Assignable users | verified | unknown | only redacted user fields are modeled |
| Field discovery | verified | unknown | IDs are returned/configured, never hard-coded |
| Create metadata | legacy Cloud endpoint marked deprecated | unknown | no replacement invented; unresolved mapping blocks apply |
| Issue/subtask create/update | verified endpoint shape | unknown | write path is outside Tasks 44–47 and approval-bound |

## Planning sprint and fields

A planning source sprint is selected by stable Jira sprint ID once configured. A name such as `Sprint Planning` is a display/default convention only; it is never used as identity. Target candidates are filtered locally to open/active sprints returned for the configured board; the remote response remains authoritative.

Story-points, competency and subtask issue-type mappings are nullable until selected from returned metadata. There are no custom field IDs in this ADR, migration, source code or fixtures. Missing, inaccessible or ambiguous mappings produce `unresolved_field_mapping`/`permission_denied` categories and block configuration/apply rather than falling back to a guessed field.

## Redacted error and conflict categories

The backend uses stable categories: `authentication_required`, `permission_denied`, `not_found`, `rate_limited`, `validation_failed`, `unsupported_capability`, `unresolved_field_mapping`, `remote_conflict`, `transport`, and `invalid_response`. Messages are safe summaries; raw headers and provider bodies are not returned.

## Fixture policy

`tests/fixtures/jira/planning/README.md` defines endpoint-shaped Cloud fixtures and a Data Center unsupported/unknown fixture. Fixture payloads use placeholder IDs and deliberately omit custom field IDs. They are contract tests, not claims that a specific Jira tenant has a particular field configuration.

## Non-goals in Tasks 44–47

This change does not add UI, writes to Jira, move-to-sprint execution, issue creation/update, approval flows, or Data Center support by inference. Those remain gated by the verified contract and later planning tasks.
