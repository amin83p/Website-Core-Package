# Chat Operation and Scope Capabilities

Access Profile reference | 3 September 2026

## Agent usage

Consult this document when:

- Configuring Access Profiles for section **`CHATS`**
- Explaining Chat modal vs Conversation Management behavior
- Deciding which operation (`READ`, `READ_ALL`, `CREATE`, `UPDATE`, `BROADCAST`, etc.) gates each action

**Critical rules:**

1. **`USER` / `SCP_USER` scope is denied** for all Chat operations in `chatOperationPolicyService`. Assign **`OWNER` (`SCP_OWNER`)** or broader scopes for normal chat users.
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Central admin bypass can grant operations, but Chat still enforces **participant**, **contact-scope**, and **target** checks for ordinary send/update unless **virtual Root** bypass applies.
3. **`BROADCAST` and `DELETE_ALL` are separate operations.** Broadcast routes use `BROADCAST`; global conversation delete uses `DELETE_ALL`.
4. **Virtual Root** accounts (`ROOT_001`, `SYS_ROOT_001`, or `isVirtualSuperAdmin`) bypass Person/contact matching as **requester or target** even without a linked Person. Other targets without a Person may still qualify when `user.organizations` supplies active membership data.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) — bypass vs ADMIN scope
- [chat-access-architecture-reference-2026-09-03.md](chat-access-architecture-reference-2026-09-03.md) — routes, sockets, storage, security

**Status:** `implemented` — aligned with `chatOperationPolicyService`, `chatContactScopeService`, `chatAccessService`, and chat routes.

---

## CHATS section pages

| Page / Where | What user can do and see |
| --- | --- |
| **Chat modal** (header) | Inbox, contact search, messaging, attachments, broadcast UI (when granted). |
| **Conversation Management** (`/chat/list`) | Scoped conversation list and history review; delete when granted. |

---

## Admin reference (Family A)

See [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) for bypass admin types.

For Chat, bypass admins may receive operations through central access, but **ordinary `UPDATE` still requires the actor to be a participant and pass live contact eligibility**, except virtual Root bypass. Category/section admin rows below describe central bypass; they do **not** replace participant or contact-scope rules for normal messaging.

| Admin type | Chat effect (summary) |
| --- | --- |
| Built-in super users / global admin / section admin | Operation grants through central access; participant + contact checks still apply for send/update unless virtual Root. |
| Scoped GENERAL category admin | Same as above for GENERAL-category sections including CHATS. |

---

## Access profile definitions — CHATS

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **Chat modal:** inbox (conversation list metadata) for conversations where the user is a **participant** only. Does **not** show message bodies, replies, or attachments without **READ_ALL**. Does not allow contact search, send, download, delete, or non-participant review. **Conversation Management:** no list access at OWNER; at DEPARTMENT/DIVISION see conversations in package scope; at ORGANIZATION/ADMIN see org-wide conversation list (metadata). |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **Chat modal:** full message history (text, replies, attachments) for participant conversations. **Conversation Management:** scoped history review matching READ list scope (package / org boundary). Does not grant send, broadcast, or delete without other operations. |

**Note:** Inbox list requires **READ** (non-USER scope). Message bodies require **READ_ALL**.

### CREATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CREATE | USER | No Access. |
| CREATE | OWNER / DEPARTMENT / DIVISION | Search eligible contacts and start a direct chat under package-role / domain rules; cannot self-chat. |
| CREATE | ORGANIZATION / ADMIN | Search active org members and start direct chats under org membership rules. |

Without **READ**, the user does not see an existing inbox list in the modal; without **READ_ALL**, they do not see message history after opening a thread.

### UPDATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | Send while participant and contact-eligible. **Limits:** 15 messages (including attachments/replies) and 50 KB per file. |
| UPDATE | DEPARTMENT / DIVISION | Same eligibility rules. **Limits:** 100 messages and 1 MB per file. |
| UPDATE | ORGANIZATION / ADMIN | Same eligibility rules; no default numeric cap (profile limits may still apply). |

Sending becomes **read-only** when another participant fails contact-scope checks (fixed read-only reason in UI).

### DOWNLOAD_FILE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DOWNLOAD_FILE | USER | No Access. |
| DOWNLOAD_FILE | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Inline/download attachments when the user can read message content (**READ_ALL**) and the message still references the file. |

### DELETE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER | No Access. |
| DELETE | OWNER | Soft-delete **own** messages only (one-sided hide for deleter). No whole-conversation delete. |
| DELETE | DEPARTMENT / DIVISION | Delete either participant's messages in-boundary conversations where user is participant (one-sided hide for deleter on narrower scopes). |
| DELETE | ORGANIZATION / ADMIN | Delete either participant's messages in participant conversations (**two-sided** tombstone for org/admin/global delete scopes). |

### DELETE_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE_ALL | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| DELETE_ALL | ORGANIZATION / ADMIN / GLOBAL | **Chat modal:** delete whole conversations for both sides when allowed. **Conversation Management:** delete any conversation when the global delete path is allowed. Does **not** grant broadcast. |

### BROADCAST

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| BROADCAST | USER | No Access. |
| BROADCAST | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN / GLOBAL | **Chat modal:** search active users and send broadcast direct messages (text and attachments). Routes `/chat/broadcast/*` gate on **BROADCAST**; `chatBroadcastService` re-checks broadcast admin. Does **not** grant Conversation Management delete or **READ_ALL** review by itself. |

---

## Contact scope (starting and sending)

- Requester needs active org (not `SYSTEM`), linked active **Person** with org membership (except **virtual Root** requester bypass).
- Targets must pass live scope rules; **virtual Root targets** always allowed; missing Person may use **`user.organizations`** fallback.
- **`GLOBAL` scope** does not make ordinary send global; only virtual Root bypasses contact matching as requester or target.

---

## Implementation references

| Concern | Location |
| --- | --- |
| Operation policy | `MVC/services/chatOperationPolicyService.js` |
| Contact scope | `MVC/services/chatContactScopeService.js` |
| Access evaluation | `MVC/services/chatAccessService.js` |
| Broadcast | `MVC/services/chatBroadcastService.js` |
| Routes | `MVC/routes/chatRoutes.js` |
| Seed section ops | `node scripts/seed-chat-section.js` |

Regenerate Word output:

```bash
node scripts/design_docs/generate_design_doc_docx.mjs docs/design_docs/chat-operation-scope-capabilities-2026-09-03.md docs/design_docs/chat-operation-scope-capabilities-2026-09-03.docx
```
