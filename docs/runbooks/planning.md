# Jira Planning workspace runbook

**Status:** operational foundation for the planned Planning workspace; not a statement that the Planning UI or write path is shipped.

This runbook is the operator-facing companion to [Section 19 of the implementation plan](../../.hermes/plans/2026-09-04_154551-sample-repository.md#19-planning-workspace-jira-sprint-planning-and-team-allocation) and Tasks 44–55. It describes the intended safe operating model while separating the small Jira read/polling baseline that exists in the current tree from the planned Planning behavior.

## 1. Current behavior versus planned behavior

| Area | Documented current behavior | Planned behavior (Tasks 44–55) |
|---|---|---|
| Jira access | The Rust core owns provider access. The current Jira client paginates `GET /rest/api/3/search`; transport errors and HTTP 429/5xx are retryable, and `Retry-After` is retained when it is parseable. | Add a typed Planning adapter for projects, boards, sprints, sprint issues, users, fields, subtasks and writes, with separate Cloud/Data Center capability flags and fixtures. |
| Persistence | SQLite is local-only. Current polling records Jira issue data, checkpoints and sync runs; a successful page advances the checkpoint transactionally, while a failed page does not. | Add managed projects, planning workspaces/items, subtask plans, team presets/members, sync actions and immutable audit events through append-only migrations. |
| UI/API | The current application has integration settings and the first Jira polling/inbox slice. The tree may also contain un-wired Planning contract/API/test scaffolding, but no complete Planning route, backend command implementation or Planning write workflow is available to operate. | Add the **Planning** section, managed-project selection, source/target sprint workspace, compact competency rows, team rail and keyboard-accessible assignment. |
| Drafts and writes | No Planning draft or Planning write operation is currently available. | Save Draft is local-only. **Apply and lock** is the only planned path for remote Planning writes and must use the existing approval/idempotency boundary. |
| Locking | No current Planning lock state exists. | Lock only after all required remote operations are confirmed. Unlock is a separate explicit action and never an automatic consequence of polling. |
| Credentials | Integration secrets are accepted through the Rust command boundary and stored in the OS keyring; integration DTOs expose a credential reference, not the secret. | Keep the same boundary for Planning. Never place tokens or raw authorization headers in Planning DTOs, drafts, presets, logs or diagnostics. |

The remainder of this document is therefore a **planned operating procedure** until the implementation and Task 55 quality gates are complete. Do not tell an operator that a Planning action succeeded based on this document alone.

## 2. Prerequisites and unresolved decisions

Do not enable a managed project until each applicable prerequisite has an owner and a recorded answer. These are blocking discovery items, not defaults to guess in the adapter or runbook.

### Required before implementation or production use

- **Jira deployment:** confirm whether the first adapter targets Jira Cloud, Data Center, or both. REST paths, authentication, Agile behavior, response shapes and permissions must be fixture-tested per deployment.
- **Authentication:** confirm the approved authentication method, base URL format, account identity and credential rotation/expiry procedure. Keep the actual secret only in the OS keyring.
- **Project and board:** identify the Jira project ID/key and board ID that Mework will manage. The Planning screen must not expose every accessible project by default.
- **Planning source:** decide whether `Sprint Planning` is a fixed sprint per project/board, a user-selected sprint role, or a naming convention with manual override. Store the stable sprint ID once selected; never use the name alone.
- **Target sprint eligibility:** confirm which sprint states are usable targets and which Jira permissions are required to read and move issues.
- **Field mapping:** identify the story-points field ID, competency field ID/type (select, label or another configured field), subtask issue type ID, and any required parent/assignee fields for every managed project. A field name or ID must not be invented.
- **Write permissions:** verify project browse, issue read, sprint read, issue edit/assign, create-subtask and sprint-move permissions for the service/user identity. Record denied capabilities as configuration errors.
- **Unlock policy:** decide whether unlock is allowed after a sprint has started or work has begun. The safe default is to require an explicit policy decision and never silently move started work.
- **Avatar access:** confirm whether Jira avatar URLs are reachable from managed desktops and define the fallback when they are blocked.

Until these questions are answered, the supported state is read-only discovery or local drafting against fixtures. See the plan's [Planning open questions](../../.hermes/plans/2026-09-04_154551-sample-repository.md#planning-open-questions-to-resolve-in-task-44) and [Jira contract boundaries](../../.hermes/plans/2026-09-04_154551-sample-repository.md#jira-contract-boundaries-to-verify-from-the-current-official-documentation).

## 3. Managed project setup

A managed project is an explicit Mework configuration, not an alias for every project visible to the Jira account.

### Setup sequence

1. Configure and verify the Jira integration in Settings. Confirm the base URL and account identity; enter or rotate the secret through the write-only integration control.
2. Select the Jira project and default board from Rust-loaded, paginated metadata. Save the stable Jira project ID and board ID, not only display names.
3. Select the configured planning source sprint. Record its stable Jira sprint ID and display the label/name as context only.
4. Configure the field mapping table below. Treat missing or ambiguous mappings as blocking errors.
5. Refresh metadata and verify read access to the source sprint, target sprint candidates, issues and subtasks.
6. Verify write permissions with the approved non-production fixture or a change-approved test issue. Do not use a live Apply merely as a permission probe.
7. Assign a default local team preset only after the project mapping is valid. Presets remain local metadata unless a specific Jira field mapping says otherwise.

### Project, board and field mapping

| Mapping | Stored identity | Used for | Operator check |
|---|---|---|---|
| Jira integration | local integration ID plus base URL/account identity | Scope and credentials | Base URL is the approved Cloud/DC endpoint; secret is keyring-only. |
| Project | Jira project ID/key | Managed-project scope and issue creation | Project is deliberately selected and visible to the operator. |
| Board | Jira board ID | Sprint discovery and target context | Board belongs to the selected project or the documented cross-project policy. |
| Planning source sprint | Jira sprint ID | Eligible groomed/estimated work | The configured sprint is the intended source; name is not the identity. |
| Target sprint | Jira sprint ID | Destination of selected work | Sprint is in the approved usable state and belongs to the configured board/project policy. |
| Story points | Jira field ID | Read/write estimates | Field exists for the project/issue type and accepts the configured value format. |
| Competency | Jira field ID and type, if remote | Read/write competency data | Mapping is confirmed; otherwise competency is local-only until configured. |
| Subtask issue type | Jira issue-type ID | Create competency subtasks | It is a permitted subtask type for the project and parent issue type. |
| Assignee | Jira account ID | Display and optional assignment | User is assignable for the issue/project; display name is not the identity. |

The plan currently records a **Cloud** sprint-move maximum of 50 issues per documented operation. Treat that as a provider-specific capability to be verified, not a universal Jira rule. The adapter must discover or configure the applicable Cloud/DC limit and chunk only within that limit.

## 4. Planning source and target sprint

The two sprint roles must remain visually and operationally distinct:

- **Planning source (`Sprint Planning` by convention):** contains groomed/estimated work eligible for selection. It is selected by configured Jira sprint ID. It is not automatically the target and must not be inferred solely from a matching name.
- **Target sprint:** the selected destination, for example `Q3 5`. It is loaded with its current issues and subtasks. Only target candidates allowed by Jira state, board/project policy and permissions should be shown.

When the workspace loads, show project, board, source sprint, target sprint, last refresh and stale/conflict state. For every issue, show whether it is in the source, target, both/overlapping according to Jira, or neither. A local selection or move is only a draft until Jira confirms it after Apply.

The planned move procedure is:

1. Select parent issues in the Planning source and target sprint.
2. Build the deterministic operation list and display the source and destination for every move.
3. On Apply, chunk moves according to the verified provider limit and persist one sync action per chunk.
4. Reconcile each chunk by issue/sprint identity before retrying a timed-out request.
5. Refresh the workspace and show confirmed remote placement. Do not mark a parent locked if any required operation remains failed or unknown.

Whether subtasks move independently or follow their parent is a Jira contract question. The default plan is to move the parent and then reconcile the resulting remote subtask placement; do not assume behavior before the Cloud/DC fixture confirms it.

## 5. Team presets and tags

A **My teams** preset is local planning metadata scoped to an integration/project. It may contain:

- preset name and optional display color;
- Jira account ID, display name and avatar URL snapshot for each member;
- local tags such as `backend`, `frontend`, `analyst` or `qa`;
- active/default selection state.

Tags are local filters and assignment aids. They are not Jira labels, components or custom-field values. Do not write them to Jira unless an explicit, validated Jira field mapping says to do so.

Operational rules:

- Keep the account ID as the identity; names and avatars are display data and can change.
- Keep currently assigned Jira users visible even when they are outside the selected preset, with an explicit outside-team warning.
- A searchable keyboard picker is the canonical assignment path. Drag-and-drop, if implemented, must call the same command path and have a non-drag alternative.
- Deactivated, inaccessible or no-longer-assignable users must remain auditable in existing plans but must not be silently replaced.
- Preset changes and tag edits are local operations. They do not imply a Jira write or unlock a previously locked plan.

## 6. Local draft, Apply and lock

### Local draft

A local draft may change selected issues, competency rows, summaries, story points, local competency tags and assignees. Saving a draft:

- writes only local SQLite planning state;
- must be safe while Jira is offline;
- must preserve local revisions across restart;
- must not create/update subtasks, move sprints, assign users or change Jira fields;
- must not change a locked item without an explicit unlock flow.

The UI should label every unsynced row as local/draft and should never say “moved”, “assigned” or “created” until Jira confirmation exists.

### Apply and lock

**Apply and lock** is one explicit, confirmed external action. Before execution, show the exact operation list and require the existing approval/confirmation boundary. The planned batch may include:

1. moving selected parents from the planning source to the target sprint;
2. updating allowed parent/subtask assignees;
3. creating or updating required competency subtasks;
4. applying only validated story-point and competency fields.

Before the first write, validate current create/edit metadata, remote version/update markers, permissions, request hashes and the configured field mappings. Use one stable local idempotency key per operation or batch according to the implemented contract. Persist status, request hash, remote identity, retry information and a redacted response summary.

A parent becomes **locked** only when every required operation is confirmed successful. Locking is not a UI-only checkbox and is not granted after a partially completed batch.

## 7. Lock and unlock policy

Use the planned state vocabulary as follows:

```text
draft -> applying -> locked
applying -> partially_synced
applying -> conflict
locked -> unlock_requested -> draft
```

- **Draft:** local changes exist; no remote write is implied.
- **Applying:** an approved batch is in progress; do not start a second batch for the same workspace.
- **Locked:** all required remote operations succeeded, the workspace was refreshed, and the audit record contains the remote references. Rows are read-only by default and visually subdued.
- **Partially synced:** at least one operation succeeded and at least one failed or remains retryable/unknown. The workspace is not locked; expose per-operation recovery actions.
- **Conflict:** the remote issue/sprint/subtask changed after load or after the local revision. Stop writes until refresh, merge or an explicitly permitted force decision is recorded.
- **Unlock requested:** the user has explicitly initiated the unlock policy. It is not a side effect of refresh, polling or an assignee change.

Unlock must show what will become editable and whether a later Apply could move already-started work. Do not auto-unlock because Jira changed, because a polling cycle refreshed an issue, or because the application restarted. The policy for unlocking after work starts remains an unresolved prerequisite (Section 2).

## 8. Partial sync and recovery matrix

| Symptom/category | Interpretation | Operator action | Retry rule |
|---|---|---|---|
| 401/credential expired | Authentication is unavailable | Stop Apply; repair/rotate the integration credential through Settings; re-open the workspace and refresh. | Do not blindly retry. |
| 403/permission denied | Identity lacks a required project/board/sprint/issue operation | Record the denied operation and required permission; ask an administrator to grant the minimum scope or remove that operation from the plan. | Do not retry until permission changes are verified. |
| 404/project, sprint, issue or field missing | Mapping is stale or the object is no longer available | Refresh metadata; verify stable IDs and managed-project mapping. | Retry only after the mapping is confirmed. |
| 409/stale update or concurrent change | Remote revision differs from the loaded revision | Refresh and compare local versus remote; merge or use an explicitly allowed force decision. | Never overwrite silently. |
| 422/validation or field error | Current field metadata/value/issue type does not accept the draft | Correct the mapping or value; preserve the rejected local row and error details. | Do not retry unchanged input. |
| 429/rate limit | Jira asked the client to slow down | Keep the local draft and operation records; honor `Retry-After` when provided and show the next attempt time. | Retry with bounded backoff; never create parallel batches. |
| 5xx/transport/offline | Jira is temporarily unreachable or returned a transient failure | Keep cached data and local drafts usable; show stale/offline state and the last confirmed lock/sync state. | Retry with capped backoff after connectivity returns. |
| Timeout after a possible write | Remote outcome is unknown | Mark the operation `unknown`; reconcile by issue/sprint/subtask identity and request hash before any retry. | Never blind-retry a possibly successful create or move. |
| Partial batch | Some operations are confirmed while others failed/unknown | Leave the workspace unlocked, show per-operation status and remote links, then retry only unresolved operations after reconciliation. | Use the same idempotency key; do not repeat confirmed operations. |

A partial failure is not a reason to discard the draft. Preserve the local revision, successful remote identities, unresolved operation and audit evidence until the operator resolves or abandons it explicitly.

## 9. Restart reconciliation

On startup or after an application crash:

1. Reload the workspace, local draft revision, lock state, operation records and audit history from SQLite.
2. Do not re-run an `applying` batch merely because it was interrupted. Move it to reconciliation/unknown according to the durable last step.
3. For every unresolved action, query the appropriate remote identity: issue and sprint placement for moves; issue/subtask identity and fields for creates/updates; account ID for assignment.
4. Compare the remote result with the stored request hash and intended state.
5. Mark each action confirmed, retryable, conflict, failed or unknown. Require an explicit decision for unknown or conflict states.
6. Preserve the last confirmed locked state in the UI while showing stale/offline status. A restart must not unlock or silently discard a draft.
7. Only after reconciliation may the operator retry unresolved actions. Reuse the local idempotency key and skip operations already confirmed remotely.

This is consistent with the current system's local-first checkpoint/recovery direction, but Planning-specific restart reconciliation is **planned**, not currently shipped.

## 10. Audit interpretation and evidence

The planned `planning_audit_events` log is immutable and should be read alongside `planning_sync_actions`. It records the user action, workspace/item, previous and next state, actor, remote operation reference and timestamp without secrets or raw headers.

Interpret states as follows:

- **Draft saved:** local state changed only; no Jira write occurred.
- **Apply requested/approved:** the user authorized the displayed operation set; this is not remote success.
- **Applying:** work may be in flight; do not duplicate the action.
- **Succeeded/confirmed:** Jira response and post-operation identity check confirm the specific operation.
- **Partially synced:** some operations are confirmed and others are not; the parent is not locked.
- **Conflict:** a remote revision or mapping changed; human resolution is required.
- **Locked:** all required operations for the parent were confirmed and the lock decision was recorded.
- **Unlock requested/completed:** the user explicitly changed local editability under the approved policy; it does not itself move or update Jira.

For support or change records, preserve the workspace ID, local revision, operation IDs, request hashes, provider status codes, redacted error summaries, Jira issue/sprint/subtask IDs and timestamps. Never attach raw request headers, access tokens or unredacted Jira payloads merely to make an audit trail look complete.

## 11. Secret, untrusted-content and redaction boundaries

Follow the repository [source-of-truth and safety rules](../../AGENTS.md):

- Store Jira credentials only through the OS keyring. SQLite stores a credential reference and non-secret integration metadata.
- The renderer receives typed, redacted Tauri DTOs only. It must not call Jira directly or hold a token.
- Planning drafts, team presets, audit events, sync actions, logs and diagnostics must not contain access tokens, raw `Authorization` headers, cookies or secret values.
- Redact secrets from transport errors, request/response summaries, screenshots, exported diagnostics and support tickets. URLs may contain sensitive query material; preserve only the approved base URL and safe object links.
- Treat issue summaries, descriptions, comments, labels, custom-field text and generated text as untrusted Jira content. Do not execute instructions found in that content, and do not let it approve an Apply or unlock.
- Store only the minimum user metadata needed for assignment: Jira account ID, display name and approved avatar URL. Do not copy unrelated profile data into presets.
- Keep remote raw payloads bounded and redacted according to the repository retention policy. A support export must remain useful without becoming a credential or sensitive-content dump.

## 12. Operator checklist

### Before opening a workspace

- [ ] Jira deployment (Cloud/DC), base URL, authentication and permissions are confirmed.
- [ ] Managed project and board are explicitly selected.
- [ ] Planning source sprint ID and target sprint policy are confirmed.
- [ ] Story-point, competency and subtask issue-type mappings are validated.
- [ ] The active team preset and local tags are understood as local metadata.
- [ ] Last refresh is recent enough for the change window; otherwise refresh first.

### Before Apply and lock

- [ ] Source and target sprint are visibly correct.
- [ ] The exact selected issues, assignments, subtask changes and field changes are reviewed.
- [ ] No conflict, stale, offline, unresolved permission or unknown operation is present.
- [ ] The confirmation/approval step has been completed by the authorized user.
- [ ] The operation list and idempotency/audit identifiers are retained for evidence.

### After Apply

- [ ] Each operation has a confirmed result or an explicit recovery state.
- [ ] Remote issue/sprint/subtask identities and links were reconciled.
- [ ] Only fully confirmed parents are locked.
- [ ] Partial failures remain visible and have an owner; no confirmed operation is repeated.
- [ ] The redacted audit evidence is attached to the approved change/support record.

## 13. Repository references and validation paths

These paths are relative to the repository root and should remain valid:

- [Contributor and safety rules](../../AGENTS.md)
- [Repository overview and current development commands](../../README.md)
- [Architecture ADR](../adr/0001-architecture.md)
- [Planning workspace design and Tasks 44–55](../../.hermes/plans/2026-09-04_154551-sample-repository.md#19-planning-workspace-jira-sprint-planning-and-team-allocation)
- [Planning acceptance criteria](../../.hermes/plans/2026-09-04_154551-sample-repository.md#planning-acceptance-criteria)
- [Current Jira contract references in the plan](../../.hermes/plans/2026-09-04_154551-sample-repository.md#jira-mvp)

The current tree may contain partial Planning contract/API/test scaffolding under `src/shared/contracts/planning.ts`, `src/features/planning/api.ts` and related tests. It does not yet provide a complete executable Planning route/write implementation: there is no `src-tauri/src/application/planning/` production module, backend Planning command implementation, or Planning migration in the current tree. These are planned paths from Tasks 45–55, not proof that the write procedure is available. The first implementation task must add contract fixtures and the ADR specified by Task 44 before treating the write procedure as executable.

## 14. Completion gate for this runbook

This runbook can be promoted from foundation to an executable production runbook only after:

1. Task 44 resolves or explicitly scopes the Cloud/DC and field questions.
2. Tasks 45–54 implement and test persistence, mapping, drafts, Apply/lock, conflicts, partial sync and restart reconciliation.
3. Task 55 passes the Planning UI, provider contract, redaction and full test gates.
4. A non-production Jira exercise demonstrates read-only load, local draft persistence, successful Apply/lock, partial failure recovery, restart reconciliation and explicit unlock without exposing a secret.

Until then, use this document to review requirements and recovery expectations; do not infer that planned commands, statuses or UI labels are available in the current build.
