# Chat Access Architecture Reference

Date: 2026-09-03

## Purpose

Working reference for section **`CHATS`**: central access evaluation, Chat-specific target checks, routes, real-time behavior, and security. For Access Profile rows by operation/scope, see [chat-operation-scope-capabilities-2026-09-03.md](chat-operation-scope-capabilities-2026-09-03.md).

**Two-step model:**

1. Central access decides whether the actor has an allowed Chat **operation** at an effective **scope**.
2. Chat decides whether the actor may act on a specific **conversation**, **contact**, **file**, or **broadcast recipient**.

---

## At a glance

| Area | Design |
| --- | --- |
| Section | `CHATS` |
| Conversations | Direct; one conversation per participant set |
| Inbox | **READ** (non-USER scope); bodies need **READ_ALL** |
| Send | **UPDATE** + participant + live contact eligibility |
| Broadcast | Dedicated **`BROADCAST`** operation (not `DELETE_ALL`) |
| Global delete | **`DELETE_ALL`** |
| Contact scope | Live Person membership + package roles; virtual Root exempt |
| Real time | Socket.IO re-checks access per event |

---

## Operations in use

| Operation | Role |
| --- | --- |
| READ | Participant inbox / list metadata |
| READ_ALL | Message bodies; scoped Conversation Management review |
| CREATE | Contact search + start chat |
| UPDATE | Send messages and uploads |
| DOWNLOAD_FILE | Guarded attachment access |
| DELETE | Scoped message / in-boundary conversation delete |
| DELETE_ALL | Global conversation delete |
| BROADCAST | Recipient search + direct-message fan-out |

**`USER` scope is denied** for all of the above in `chatOperationPolicyService`. Use **`OWNER`** or broader in profiles.

---

## Contact scope and Root exemption

- Normal users: active Person, org membership, package-role boundaries per scope mode.
- **Virtual Root** (`ROOT_001`, `SYS_ROOT_001`, `isVirtualSuperAdmin`): bypass contact checks as **requester and target** without Person.
- **Targets** without Person: `resolveContactPerson()` may use **`user.organizations`**.
- **`BROADCAST`**, **`DELETE_ALL`**, section admin, or **ADMIN** scope alone does **not** bypass contact rules for ordinary **CREATE** / **UPDATE**.

Read-only messaging uses a fixed reason when another participant is outside scope.

---

## HTTP routes (summary)

| Route | Operation gate |
| --- | --- |
| `GET /chat/conversations` | READ |
| `GET /chat/messages/:convId` | READ_ALL |
| `GET /chat/attachments/:convId/:fileName` | DOWNLOAD_FILE |
| `POST /chat/start`, `GET /chat/users/search` | CREATE |
| `POST /chat/upload` | UPDATE |
| `GET /chat/broadcast/users/search` | **BROADCAST** |
| `POST /chat/broadcast/:convId` | **BROADCAST** |
| Delete message / conversation routes | DELETE and/or DELETE_ALL |

Broadcast paths re-check **`isChatBroadcastAdmin()`** in service code.

---

## Real-time (Socket.IO)

| Event | Condition |
| --- | --- |
| `join_room` | READ_ALL (+ review/participant rules) |
| `send_message` | UPDATE + participant + contact eligibility + UPDATE limits |
| `mark_delivered` / `mark_read` | READ or READ_ALL (participant) |
| Attachments on send | `fileUrl` must pass **`chatPendingAttachmentService.consumePendingAttachment`** |

---

## Deletion visibility

| Delete scope mode | Message delete visibility |
| --- | --- |
| OWNER / DEPARTMENT / DIVISION | One-sided (hidden for deleter) |
| ORGANIZATION / ADMIN / GLOBAL | Two-sided tombstone |

---

## Security highlights

- Guarded attachment route; blocked static `/uploads` chat prefixes
- CSRF on mutating HTTP routes
- Socket identity from auth token (not client `identify` payload)
- Separate **BROADCAST** and **DELETE_ALL** grants on profiles

---

## Implementation references

| Module | Path |
| --- | --- |
| Access | `MVC/services/chatAccessService.js` |
| Contact scope | `MVC/services/chatContactScopeService.js` |
| Policy | `MVC/services/chatOperationPolicyService.js` |
| Broadcast | `MVC/services/chatBroadcastService.js` |
| Sockets | `MVC/services/socketService.js` |
| Pending attachments | `MVC/services/chatPendingAttachmentService.js` |

Regenerate Word output:

```bash
node scripts/design_docs/generate_design_doc_docx.mjs docs/design_docs/chat-access-architecture-reference-2026-09-03.md docs/design_docs/chat-access-architecture-reference-2026-09-03.docx
```
