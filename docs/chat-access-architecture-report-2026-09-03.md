# Chat Access Architecture Reference

Date: 2026-09-03

## Purpose and Status

This document is the working access reference for the `CHATS` section. It describes the implemented behavior, the generic Access Profile definition model, the meaning of each scope, Chat-specific constraints, administration levels, routes, data flows, and security considerations.

The most important distinction is this:

1. The central access system decides whether an actor has an allowed Chat operation.
2. Chat then decides whether the actor may act on a specific conversation, contact, file, or broadcast recipient.

Chat now translates operation scopes into live Person membership and package-role checks for contact discovery, starting/sending conversations, and deletion. `READ` remains participant-only and `READ_ALL` remains the explicit audit/history operation; scope is not a general non-participant read grant.

## Chat at a Glance

| Area | Current design |
| --- | --- |
| Section identifier | `CHATS` |
| Conversation type | Direct conversation; one reusable conversation is created per same set of participants. |
| Read model | Participants can read their own history with `READ`; `READ_ALL` can read non-participant history. |
| Write model | A participant needs `UPDATE` and must remain eligible under the contact-scope policy. |
| Contact model | `CREATE` and `UPDATE` use the effective scope: standard user/owner behavior, shared package domain (`DEPARTMENT`), exact package role (`DIVISION`), or active organization membership (`ORGANIZATION`/`ADMIN`). |
| Attachments | Stored in the global Chat upload area; served only through a permission-checked Chat route. |
| Broadcast | A privileged direct-message fan-out; currently uses `DELETE_ALL` because there is no dedicated `BROADCAST` operation. |
| Back ends | JSON files or MongoDB through `chatRepository`. |
| Real time | Socket.IO authenticates the user and re-checks access for each conversation event. |

## Access Decision Flow

```text
Request or socket event
        |
        v
Authentication and session/token validation
        |
        v
Central access evaluation for CHATS + operation
  - profile, user policy, organization policy
  - network, schedule, limits, access state
  - effective operation scope and admin context
        |
        v
Chat-specific target check
  Read: participant OR READ_ALL for non-participant history
  Write: participant AND current contact eligibility
  Delete: scope-aware message/conversation decision
  File: DOWNLOAD_FILE AND readable conversation AND active message file reference
  Broadcast: global manager with DELETE_ALL
        |
        v
Repository action, response, and optional socket notification
```

The route middleware provides the first operation check. Controllers and socket handlers repeat the conversation-level check; this prevents a caller from using a known conversation ID, direct socket event, or attachment URL to bypass the intended target rule.

## Access Profile Definition

An Access Profile configures a section and its operations. For Chat, the operative fields are:

| Field | Meaning in Chat |
| --- | --- |
| Section | `CHATS`. A section ban stops all Chat operations, even if an operation is otherwise granted. |
| Section access type | `custom` uses the configured operation rows. `full_access` acts as section administration and grants all Chat operations. `full_ban` denies the section. |
| Operation | One of the Chat operations in the table below. Operations not used by Chat have no Chat route or behavior. |
| Operation access type | `custom` is an explicit operation grant; `full_access` grants the operation and makes it operation-admin level; `full_ban` denies it. |
| Scope | A scope record ID/name, such as `USER`, `OWNER`, `DEPARTMENT`, `DIVISION`, `ORGANIZATION`, `ADMIN`, or `GLOBAL`. It is returned as `scopeId` from central access evaluation. |
| Operation admin access | `adminAccess: true` makes the operation an operation-administration grant. An `ADMIN` scope also resolves as operation-admin in the generic authority service. |
| Limits | The effective access evaluator returns operation limits. Chat passes these through to the request context, but the current Chat controllers do not define Chat-specific numeric limits beyond upload middleware limits. |
| Profile organization | A profile associated with an organization applies only in that organization context. A profile without an organization may apply more broadly, subject to policy. |

### Effective Access Precedence

The central resolver combines the active profile with the active user policy and active organization policy. In practical terms:

- A targeted organization-policy section is authoritative for the targeted user when it exists.
- A `full_ban` at the section or operation level denies access, including otherwise broad grants.
- Section `full_access`/section administration makes all operations available for that section.
- An operation `full_access`, `adminAccess`, or `ADMIN` scope makes that operation an operation-admin grant.
- The final decision also considers the standard access checks such as authentication, applicable organization, network policy, schedule, and limits.

Do not use an `ADMIN` scope merely to mean "a large audience." In the generic authority system it carries administrative meaning.

## Chat Operations

Only the following generic operations have Chat behavior today.

| Operation | What it enables | Chat-specific condition | Recommended least-privilege assignment |
| --- | --- | --- |
| `READ` | Open Chat, list the actor's conversations, and read participant history. | The actor must be a conversation participant. | Standard Chat users. |
| `READ_ALL` | View the global conversation-management list and read history where the actor is not a participant. | No participant requirement for HTTP history/list management. | Auditors/support staff with a documented need. |
| `CREATE` | Search eligible contacts and start a direct conversation. | Target must pass current contact-scope eligibility; self-chat is denied. | Users who may initiate conversations. |
| `UPDATE` | Send text, upload an attachment, and send a real-time message. | Actor must be a participant and still be eligible to message every other participant. | Users who may send messages. |
| `DOWNLOAD_FILE` | View inline or download a Chat attachment. | Actor must also be able to read the conversation. | Users who need attachment access. |
| `DELETE` | Soft-delete authorized messages and, at broader scopes, delete an authorized whole conversation. | `USER`/`OWNER`: own messages only. `DEPARTMENT`, `DIVISION`, `ORGANIZATION`, and `ADMIN`: every participant must be within the live boundary. | Restrict carefully; individual message deletion leaves a visible tombstone. |
| `DELETE_ALL` | Delete any conversation and use broadcast recipient search/direct-message fan-out. | Global-management check is repeated in the service. | A very small Chat operations-admin group. |

`READ_ALL` is intentionally separate from `DELETE_ALL`: read/audit authority must not automatically include destructive or broadcast authority.

## Scope Definitions

The generic scope catalog supports these modes. Chat maps them to live active Person memberships and the existing package-role registry; it does not introduce department or division tables.

| Scope | Chat boundary | `CREATE` / `UPDATE` effect | `DELETE` effect |
| --- | --- | --- | --- |
| `USER` | The actor as a participant. | Standard eligible-contact behavior; `UPDATE` still requires participation. | Only messages sent by the actor; no whole-conversation delete. |
| `OWNER` | The actor as the author of a message. | Same practical behavior as `USER` for direct conversations. | Only messages sent by the actor; no whole-conversation delete. |
| `DEPARTMENT` | Same active organization and at least one shared recognized package domain, such as School. | Discover, start, and continue a chat only across the shared package-domain boundary. | Either participant's messages and a whole conversation only when every participant shares a package domain with the actor. |
| `DIVISION` | Same active organization and one identical recognized package-role key, such as `school_teacher`. | Discover, start, and continue a chat only across the exact package-role boundary. | Either participant's messages and a whole conversation only when every participant shares that exact role with the actor. |
| `ORGANIZATION` | Same active organization and an active membership with at least one role, including `member`. | Discover, start, and continue chats with active members of the organization. | Either participant's messages and whole conversations inside that organization. |
| `ADMIN` | The resolved administrative organization boundary. | Uses the organization contact boundary; it does not bypass membership validity. | Either participant's messages and whole conversations inside the administrative boundary. |
| `GLOBAL` | System-wide. | Does not bypass normal participation for ordinary `UPDATE`. Only virtual Root bypasses contact matching. | Allows global deletion when granted on `DELETE`; `DELETE_ALL` is also global. |

### Why `OWNER` Is Usually Wrong for Direct Chat

A direct conversation is shared by all participants. If `OWNER` meant "only the creator can read," a recipient could lose access to a conversation they legitimately participate in. For standard Chat, use `USER`/participant semantics. Use a separate authored-record feature only when a conversation has a genuine single owner and recipient visibility is designed independently.

### Whole-Conversation Boundary Rule

For deletion at `DEPARTMENT`, `DIVISION`, `ORGANIZATION`, or `ADMIN`, Chat requires **every** conversation participant to be within the actor's current boundary. This avoids a partial match allowing deletion of a conversation that crosses into another team.

| Scope | Conversation rule |
| --- | --- |
| `USER` | Actor is a participant. |
| `OWNER` | Actor authored every message being deleted; never a whole-conversation grant. |
| `DEPARTMENT` | Every participant shares at least one recognized package domain with the actor. |
| `DIVISION` | Every participant shares one exact recognized package role with the actor. |
| `ORGANIZATION` | Every participant has an active membership in the active organization. |
| `ADMIN` | Every participant is within the resolved administrative boundary; make that boundary explicit. |
| `GLOBAL` | All conversations, subject to the granted delete operation and audit logging. |

The resolver uses current memberships and roles. Consequently, a revoked membership or role immediately prevents future start/send/delete actions but does not remove participant history already readable under `READ`.

## Access Definition Matrix: Operation by Scope

The scope is evaluated for the operation being performed. `ADMIN` also has the generic operation-administration effect, but it does not bypass Chat's object-level checks.

| Operation | `USER` / `OWNER` | `DEPARTMENT` | `DIVISION` | `ORGANIZATION` / `ADMIN` | `GLOBAL` |
| --- | --- | --- | --- | --- | --- |
| `READ` | Participant history only. | Participant history only. | Participant history only. | Participant history only. | Participant history only. |
| `READ_ALL` | Global audit/history operation; scope does not narrow the current audit list/history implementation. | Same. | Same. | Same. | Same. |
| `CREATE` | Standard eligible contacts. | Shared package domain. | Shared exact package role. | Active members in the same organization/boundary. | Standard contact checks; Root is the only bypass. |
| `UPDATE` | Eligible participant only. | Eligible participant with shared package domain. | Eligible participant with shared exact package role. | Eligible participant with active same-organization membership. | Eligible participant; not a general moderator send grant. |
| `DOWNLOAD_FILE` | Readable conversation plus `DOWNLOAD_FILE` and an active attachment reference. | Same. | Same. | Same. | Same. |
| `DELETE` | Own messages only; no conversation delete. | Delete either side's messages or a whole conversation only when all participants share the package boundary. | Same rule using exact role. | Delete either side's messages or a whole conversation inside the boundary. | Global messages/conversations. |
| `DELETE_ALL` | Global messages/conversations and broadcast authority; scope label does not narrow it. | Same. | Same. | Same. | Same. |

### Scope Design Guidance Per Operation

| Operation | Recommended scope | Reason |
| --- | --- | --- |
| `READ` | `USER` | It corresponds to participant-owned access and does not create non-participant review rights. |
| `READ_ALL` | `ADMIN` or `GLOBAL`, with an explicit policy choice | It is global in current Chat code. Do not assign it to a normal user profile, regardless of its configured label. |
| `CREATE` | Match the intended contact audience | Use `DEPARTMENT`, `DIVISION`, or `ORGANIZATION` only when that live membership boundary is desired. |
| `UPDATE` | Match `CREATE` | The same scope must be used for continuing sends, preventing a contact-search bypass. |
| `DOWNLOAD_FILE` | `USER` | It is additionally bound to conversation readability. |
| `DELETE` | `USER` for own-message deletion; broader scope only for moderated deletion | `DEPARTMENT`/`DIVISION` require all participants to match; `ORGANIZATION`/`ADMIN` are organizational moderation boundaries. |
| `DELETE_ALL` | `ADMIN` or `GLOBAL` | It is global destructive and broadcast authority. Prefer a dedicated small operations-admin group. |

## Administration Levels

Administration levels come from the generic `adminAuthorityService`; they are not all identical and not all imply the same Chat power.

| Administration level | How it is recognized | Chat consequence | Important limit |
| --- | --- | --- | --- |
| Super admin | Virtual Root account, `isSuperAdmin`, or access level at least `10`. | Broad central access authority; virtual Root also bypasses the Chat contact-scope policy. | A non-Root super-admin should not be assumed to bypass Chat participant rules for normal `UPDATE`; Chat checks those separately. |
| Global Chat manager | Functional Chat role, not a separate generic admin type: `DELETE_ALL` is allowed and the actor is an admin for that request, or the `DELETE_ALL` operation itself is allowed. | Can delete any conversation and search/broadcast to active users. | Does **not** grant `READ_ALL` by itself. |
| System/full admin | Active profile has `fullAdmin`. | Is a section administrator in generic authority resolution and normally receives operation access through the section. | Organization/profile applicability and policy bans still matter. |
| Category admin | Active profile has the category that contains the resolved `CHATS` section. | Generic administrator for that category/section request. | Category depends on the section catalog record; it is not a replacement for assigning sensitive Chat operations deliberately. |
| Section admin | `CHATS` section has `adminAccess`, or policy grants the section `full_access`. | All operations in the `CHATS` section are available through generic access evaluation. | Does not by itself bypass Chat's contact/participant target rules unless the operation has a special global rule. |
| Operation admin | Operation has `adminAccess`, `full_access`, or an `ADMIN` scope. | Administrative authority for that one operation. | The operation's own Chat behavior remains decisive: `UPDATE` is still participant/contact constrained, while `DELETE_ALL` is global. |

### Practical Examples

| Role design | Suggested grants | Result |
| --- | --- | --- |
| Regular member | `READ`, `CREATE`, `UPDATE`, `DOWNLOAD_FILE` at `USER`. | Can find eligible contacts, chat, and access files in their conversations. |
| Read-only participant | `READ` and optionally `DOWNLOAD_FILE` at `USER`. | Can read own conversations and optionally files, but cannot initiate or send. |
| Support/auditor | `READ`, `READ_ALL`, `DOWNLOAD_FILE` with an `ADMIN`/`GLOBAL` review policy. | Can inspect global Chat history and attachments; cannot send, broadcast, or delete unless separately granted. |
| Broadcast operator | `READ`, `READ_ALL` if review is needed, and `DELETE_ALL` at `ADMIN`. | Can use global management/broadcast. This is powerful and should be rare. |
| Chat section administrator | `CHATS` section `adminAccess`. | Central access grants all Chat operations; the person can still only use ordinary send/update where they are a participant, but can global-delete/broadcast through `DELETE_ALL`. |

## Contact Scope for Starting and Sending Chats

The shared contact resolver applies the effective `CREATE` or `UPDATE` scope to both contact search/start and ongoing sends. `UPDATE` always also requires the actor to be a conversation participant.

### Baseline Requirements

- The requester has an active user account.
- The requester selects an active organization; `SYSTEM`/no organization is not enough.
- The requester has a linked, active Person record.
- The Person has an active membership in the selected organization.
- Recognized package-role assignments are valid. An unknown role assignment fails closed for role-scoped Chat.
- The target has an active user account, linked active Person, and active membership in the same selected organization.
- For `USER`/`OWNER`, the standard contact policy permits a shared recognized package domain, such as School-to-School or PTE-to-PTE, or plain-member-to-plain-member.
- For `DEPARTMENT`, requester and target must share a recognized package domain; plain-member fallback is not allowed.
- For `DIVISION`, requester and target must share an exact recognized package-role key in addition to the same organization.
- For `ORGANIZATION`/`ADMIN`, requester and target must have an active membership with at least one role in the same organization. The `member` role qualifies.
- `GLOBAL` does not make ordinary contact/send actions global; only virtual Root bypasses the contact boundary.
- Users cannot start a chat with themselves.

### Existing Conversations When Scope Changes

Conversation history remains readable to a participant with `READ`, even if a role, membership, Person record, or contact relationship later changes. Sending becomes read-only while the other participant is no longer eligible. This preserves history while preventing new communication across a revoked boundary.

### Root Exception

Only the virtual Root account is treated as a bypass in the Chat contact-scope service. Assigning an `ADMIN` scope, section administration, category administration, or `DELETE_ALL` does not by itself bypass contact eligibility for ordinary `CREATE` or `UPDATE` actions.

## HTTP Route Reference

All Chat routes are mounted at `/chat`, require authenticated HTTP access, and use the Chat operation middleware before the controller.

| Method and route | Initial operation gate | Controller-level protection and behavior |
| --- | --- | --- |
| `GET /chat/conversations` | `READ` or `READ_ALL` | Returns only conversations where the requester is a participant. `READ_ALL` does not currently make this inbox global. |
| `GET /chat/messages/:convId` | `READ` or `READ_ALL` | Participant may read; a user with `READ_ALL` may read a non-participant conversation. Participant reads update last-read state when not paginating older history. |
| `GET /chat/attachments/:convId/:fileName` | `DOWNLOAD_FILE` | Requires download permission, conversation readability, and a non-deleted message that still references the file. Supports `?download=1` for attachment disposition. |
| `POST /chat/start` | `CREATE` | Rejects self-chat and requires the selected target to pass contact-scope eligibility. |
| `GET /chat/users/search` | `CREATE` | Returns up to 20 eligible contacts by default, maximum 50. |
| `POST /chat/upload` | `UPDATE` | Accepts up to 5 files, then confirms the requester is an eligible conversation participant before returning stored file references. |
| `DELETE /chat/messages/:convId/:messageId` | `DELETE` or `DELETE_ALL` | Atomically authorizes and soft-deletes one message. `USER`/`OWNER` may delete only their own messages; broader scopes use the all-participants boundary. |
| `POST /chat/messages/bulk-delete` | `DELETE` or `DELETE_ALL` | Accepts `{ messageIds }`. Every message is checked before any write; any invalid/stale ID rejects the entire deletion. |
| `DELETE /chat/delete/:convId` | `DELETE` or `DELETE_ALL` | Whole-conversation deletion. `USER`/`OWNER` are denied; scoped staff must match every participant; `DELETE_ALL` is global. Existing whole-conversation attachment cleanup is retained. |
| `GET /chat/list` | `READ_ALL` | Renders the global conversation-management list. |
| `GET /chat/broadcast/users/search` | `DELETE_ALL` | Re-checks global Chat manager status and lists active recipients, default 50, maximum 200. |
| `POST /chat/broadcast/:convId` | `DELETE_ALL` | Re-checks global manager status; delivers text/files as direct messages to selected active users. The path parameter is not used to authorize or choose the recipient conversations. |

### HTTP Response Details

- Message history is paginated: default page size is 50, maximum is 100, with the `before` message ID cursor.
- The inbox includes unread totals and messaging availability/reason.
- Attachment responses use `Content-Disposition: inline` by default or `attachment` with `download=1`; they also set `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
- JSON/AJAX callers receive structured error responses for access denials where appropriate; the global list renders the standard error view for denied browser requests.

## Real-Time Socket Events

Socket.IO validates the `auth_token` cookie and requires `READ` or `READ_ALL` before connecting. The current token is re-resolved before conversation-level events.

| Event | Required Chat condition | Notes |
| --- | --- | --- |
| `identify` | Authenticated socket | Supplied user ID is ignored, preventing identity spoofing. |
| `join_room` | `READ` or `READ_ALL`, but participant-only target check | A `READ_ALL` auditor cannot join a non-participant room through this event because the socket path does not enable global read. HTTP history still permits the audit read. |
| `send_message` | `UPDATE`, participant, and current contact eligibility | Message sender ID comes from the authenticated socket. Optional `replyToMessageId` is resolved to a server-created reply snapshot. |
| `mark_delivered` | Readable participant conversation | Updates message delivery state. |
| `mark_read` | Readable participant conversation | Updates status; only a participant can update their unread state. |
| `mark_conversation_read` | Readable participant conversation | Marks the actor's conversation read and emits an unread-state update. |
| `message_deleted` | Server-emitted only | Broadcast to the conversation after a single or bulk soft deletion so open clients render tombstones immediately. |
| `conversation_deleted` | `DELETE` participant or `DELETE_ALL` global manager | Emits the deletion notification to the room; HTTP delete performs the actual deletion. |

## Conversation and Storage Model

### Conversation Data

Conversations have an ID, direct type, participants, timestamps, unread/last-read state, last-message summary, and message count. Each participant currently stores a `userId`, `lastRead`, and `unreadCount`.

Messages contain an ID, sender ID, content, type (`text`, `image`, or `file`), optional file reference, timestamp, and delivery status. A reply message also stores a server-created `replyTo` snapshot with the original message ID, sender ID, type, and safe preview/file label. Soft deletion stores `deletedAt`, `deletedByUserId`, and `deletionScope`, replaces content with `Message deleted`, and clears the file reference.

The current model does not persist a conversation `orgId`, department ID, division ID, or creator ID. Scoped contact and deletion decisions therefore resolve the participants' current active Person memberships and package-role assignments at request time. This makes revocation immediate, while ordinary history reads remain participant-based.

### Persistence

| Back end | Conversations | Messages |
| --- | --- | --- |
| JSON | `data/conversations.json` | Individual files under `data/messages/<conversationId>.json`. |
| MongoDB | `chatConversations` collection | Embedded `messages` array in the conversation document. |

The repository enforces only two list modes: participant scope (`participants.userId`) and `canViewAll`. The global administration list uses `canViewAll`; normal inboxes use participant scope.

## Attachment Architecture

1. Upload middleware stores Chat files under the configured `core.chat` template, ordinarily `chat/{conversationId}`, in the global upload space.
2. The upload controller confirms `UPDATE` plus current participant/contact eligibility; it cleans up uploaded files when that controller check fails.
3. Active message records keep the stored file reference. Soft deletion clears it while retaining reply snapshots.
4. The client converts message attachments to `/chat/attachments/:convId/:fileName`.
5. The guarded endpoint checks `DOWNLOAD_FILE`, conversation readability, and an active message reference; it then validates the filename, reads only known Chat upload locations, and returns the file.
6. The `/uploads` static middleware returns `404` for configured/default Chat upload prefixes, preventing direct static access to Chat attachments.

The attachment resolver checks both the configured folder and the default folder to support configuration changes and older stored files. The upload-folder template should retain a stable path prefix before `{conversationId}`, such as `chat/{conversationId}` or `secure-chat/{conversationId}`, so the static blocking rule can recognize it.

## Security Controls Present

| Control | Coverage |
| --- | --- |
| Authentication | All HTTP Chat routes use `requireAuth`; Socket.IO validates the authenticated token. |
| CSRF | Application-wide CSRF protection applies to Chat POST and DELETE requests. |
| Operation authorization | Chat route middleware evaluates the exact `CHATS` operation and captures effective scope/limits. |
| Object authorization | Controllers and socket handlers re-check conversation participant/global/read/write/delete rules. |
| Contact authorization | Contact search, create, and ongoing send eligibility use active user/Person/membership/package-role rules. |
| Attachment authorization | Files use a guarded endpoint requiring `DOWNLOAD_FILE`, readable-conversation access, and a non-deleted message reference. |
| Static-file protection | Direct `/uploads` access to Chat folder prefixes is blocked. |
| Path safety | Attachment filename validation and safe file resolution prevent traversal through the public attachment endpoint. |
| Cache/content hardening | Attachment responses are private/no-store and set `nosniff`. |
| Upload limits | At most five Chat files per upload; per-file maximum is centrally configured. |
| File filtering | Non-super-admin uploads are limited by extension and declared MIME-type allowlists. |
| Broadcast checks | Broadcast recipient search and sending re-check global Chat manager status in the service, not only at the route. |
| Identity integrity | Socket `identify` ignores client-provided identity; server-side sender ID is used for messages. |

## Security Risks and Follow-Up Work

These are the remaining safeguards and design decisions after implementing scope-aware contacts and deletion.

| Priority | Item | Why it matters | Recommended action |
| --- | --- | --- | --- |
| High | `READ_ALL` remains global. | Its configured scope label does not narrow the current audit list/history implementation. | Add a dedicated scoped audit operation and resolver before delegating organization/department/division review. |
| High | `DELETE_ALL` doubles as broadcast permission. | Broadcast is not deletion; a broadcaster receives global destructive authority. | Add a dedicated `BROADCAST` operation, move both broadcast routes/services to it, and retain `DELETE_ALL` only for deletion. |
| High | Socket message payload includes client-supplied `fileUrl`. | A direct socket caller can submit an arbitrary file reference unless the client/server contract is further constrained elsewhere. | Accept only server-issued attachment IDs/references tied to the conversation and sender; validate before storing. |
| Medium | Upload is written before controller conversation authorization. | Multer saves the file before `convId`/participant eligibility is checked; the controller cleans up on failure, but authorization-before-write is stronger. | Add a pre-upload conversation authorization middleware that reads/validates `convId` before storage, or use temporary quarantine storage followed by an authorized move. |
| Medium | MIME filtering trusts the request-declared MIME type. | File extension plus declared MIME type is useful but is not content inspection. Super admins currently bypass the allowlist entirely. | Add content-signature validation and malware scanning; avoid broad super-admin MIME bypass unless operationally necessary. |
| Medium | Boundary changes are live. | Membership and role revocation correctly removes future authority, but historical scope at send time is not retained. | Add immutable authorization/audit records if later forensic reconstruction is required. |
| Medium | Global review should be auditable. | `READ_ALL` exposes private message history. | Record immutable events for list/history/attachment review: actor, operation, scope, target, timestamp, IP/request ID, and outcome. |
| Medium | Soft delete has no retention/restore workflow. | Tombstones preserve conversation context, but there is no undelete, legal hold, or deletion audit store. | Define retention, legal hold, restore, and immutable deletion-audit requirements. |
| Low | Configured-folder size reporting uses the legacy default path in the admin list. | Storage reporting can undercount if `core.chat` has a custom template. | Use the same configured/default folder enumeration as the attachment resolver. |

## Remaining Scoped-Review Work

Chat now has shared contact/delete scope resolvers. A separate review resolver is still needed if `READ_ALL` must become scoped rather than global:

1. Resolve the effective scope definition from the allowed operation.
2. Resolve the actor's active organization, permitted departments, divisions, user ID, and Person ID from the scope bindings.
3. Resolve every conversation participant's active organization/department/division at the time of evaluation, or store an immutable classification snapshot with a documented retention policy.
4. Return a repository-compatible filter and a single-conversation predicate.
5. Apply the predicate consistently to the audit inbox, history, attachment review, and Socket.IO room joins.
6. Keep ordinary `UPDATE` participant/contact-scoped unless a separate, explicitly designed moderator-message operation is introduced.

For review power, use a dedicated operation such as `READ_AUDIT` or make `READ_ALL` scope-aware. Do not overload ordinary `READ` to grant non-participant review without recording the policy choice and audit trail.

## Configuration Checklist

- Assign normal users `READ`, `CREATE`, `UPDATE`, and `DOWNLOAD_FILE` at `USER` scope.
- Assign `DELETE` at `USER`/`OWNER` for own-message deletion. Use broader scopes only for staff allowed to soft-delete another participant's message or an entire in-boundary conversation.
- Assign `READ_ALL` only to verified audit/support roles and document that it is global in the current implementation.
- Assign `DELETE_ALL` to the smallest possible administrative group; it includes broadcast power today.
- Avoid giving ordinary users a `CHATS` section `full_access`, category admin, or `ADMIN`-scoped sensitive operation unless the resulting administrative effect is intentional.
- Keep active organization, Person links, memberships, and package-role registry data correct; Chat contact eligibility depends on them.
- Preserve a stable Chat upload-folder prefix before `{conversationId}`.
- Test HTTP and Socket.IO behavior whenever changing an operation, scope definition, policy, or role assignment.

## Verification Coverage

The current focused tests cover:

- `READ_ALL` allowing non-participant conversation reads even though `READ` is evaluated first.
- Guarded attachment URL construction and static upload-path blocking.
- Attachment download requiring `DOWNLOAD_FILE`, readable-conversation access, and an active message file reference.
- Contact-scope eligibility and read-only behavior when eligibility changes.
- Global Chat management/broadcast checks.
- Context-menu visibility, reply payload wiring, message tombstones, scoped deletion routes, and multi-select deletion contract coverage.

## Message Actions and Scoped Deletion Update

### Message Action Menu

Each non-deleted message supports a desktop right-click and touch long-press action menu. The menu exposes only actions valid for the message and the current access profile:

| Action | Availability |
| --- | --- |
| Select | Any non-deleted message. Enables multi-select mode. |
| Reply | Any non-deleted message. The next outgoing message stores a server-created reply snapshot. |
| Copy | Text messages only. |
| Delete | Requires `DELETE` or `DELETE_ALL` and scope authorization. |
| Download | Image/file messages only; requires `DOWNLOAD_FILE` and readable-conversation access. |

In multi-select mode the only operation is Delete. The server validates every selected message before changing any of them, so a selection is deleted atomically or not at all.

### Reply and Soft Delete Lifecycle

- A reply stores `{ messageId, senderId, type, preview }`; the browser supplies only the target message ID and the server creates the snapshot.
- When a text and attachments are sent together, the text message receives the reply reference. When attachments are sent without text, the first attachment receives it.
- Individual deletion is soft deletion. The message becomes `Message deleted`, loses its file reference, and records `deletedAt`, `deletedByUserId`, and `deletionScope`.
- Reply snapshots remain visible after the source message is deleted. Deleted file messages cannot be downloaded through the guarded attachment route.

### Effective Delete Scope

| Scope | Contact/start/send boundary | Message deletion | Whole-conversation deletion |
| --- | --- | --- | --- |
| `OWNER` / `USER` | Existing participant/contact rules. | Only messages sent by the actor. | Not allowed through `DELETE`. |
| `DEPARTMENT` | Same active organization and at least one shared recognized package domain, such as School. | Either participant's messages when every participant matches the package boundary. | Allowed when every participant matches the package boundary. |
| `DIVISION` | Same active organization and at least one shared exact recognized package role, such as `school_teacher`. | Either participant's messages when every participant matches the role boundary. | Allowed when every participant matches the role boundary. |
| `ORGANIZATION` | Same active organization and an active membership with at least one role, including `member`. | Either participant's messages within that organization. | Allowed within that organization. |
| `ADMIN` | Administrative organization boundary. | Either participant's messages within the boundary. | Allowed within the boundary. |
| `GLOBAL` / `DELETE_ALL` | Global management boundary. | Any message. | Any conversation. |

### New Interfaces

| Interface | Purpose |
| --- | --- |
| `DELETE /chat/messages/:convId/:messageId` | Soft-delete one authorized message. |
| `POST /chat/messages/bulk-delete` | Atomically soft-delete authorized `messageIds` for a conversation. |
| Socket `send_message.replyToMessageId` | Requests a server-created reply snapshot for a new message. |
| Socket `message_deleted` | Updates all connected participants after a successful delete. |

### Security Notes

- The UI never decides final permission. Delete routes, services, repository writes, and Socket.IO notifications use server-side checks.
- Scope comparison uses current active Person memberships and the package role registry. Removing a role/membership immediately removes future send/delete authority.
- `DELETE_ALL` remains global and still includes broadcast authority until a dedicated broadcast operation is added.
- Soft-deleted attachment references are removed from the message, and the guarded attachment route rejects direct URLs that no longer have an active message reference.

## Implementation References

- `MVC/services/chatAccessService.js`: operation evaluation and conversation/file/delete authorization.
- `MVC/services/chatContactScopeService.js`: contact eligibility and read-only messaging state.
- `MVC/services/chatBroadcastService.js`: global manager verification and broadcast delivery.
- `MVC/routes/chatRoutes.js`: HTTP route gates.
- `MVC/controllers/chatController.js`: controller-level target checks and responses.
- `MVC/services/socketService.js`: real-time authentication, access checks, and notifications.
- `MVC/services/chatAttachmentAccessService.js`: guarded attachment resolution and protected upload-path detection.
- `MVC/repositories/chatRepository.js`: participant/global list scopes and persistence abstraction.
- `MVC/utils/scopeDefinitionHelper.js`: generic scope modes, bindings, and default definitions.
- `MVC/services/security/effectiveAccessResolverService.js`: effective profile/policy/scope resolution.
- `MVC/services/adminAuthorityService.js`: super/category/section/operation administration resolution.
