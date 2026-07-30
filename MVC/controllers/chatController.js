// MVC/controllers/chatController.js
const chatRepository = require('../repositories/chatRepository');
const { idsEqual } = require('../utils/idAdapter');

const dataService = require('../services/dataService'); 
const chatAccessService = require('../services/chatAccessService');
const chatContactScopeService = require('../services/chatContactScopeService');
const coreFilesService = require('../services/coreFilesService');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { OPERATIONS } = require('../../config/accessConstants');
const uploadMiddleware = require('../middleware/upload');
const fileAssetStorage = require('../services/fileAssetStorageService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const { normalizeUnreadCount } = require('../services/chatUnreadStateService');

/* ==========================================================================
   HELPERS
   ========================================================================== */

// Helper: Calculate Folder Size (Recursive)
function getFolderSize(directoryPath) {
    let totalSize = 0;
    try {
        if (fs.existsSync(directoryPath)) {
            const files = fs.readdirSync(directoryPath);
            for (const file of files) {
                const filePath = path.join(directoryPath, file);
                const stats = fs.statSync(filePath);
                if (stats.isDirectory()) {
                    totalSize += getFolderSize(filePath);
                } else {
                    totalSize += stats.size;
                }
            }
        }
    } catch (e) {
        // Ignore permission errors or race conditions
    }
    return totalSize;
}

// Helper: Format Bytes
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function createHttpError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function loadConversationOrThrow(convId) {
    const conversation = await chatRepository.getById(convId);
    if (!conversation) throw createHttpError('Conversation not found.', 404);
    return conversation;
}

async function assertCanReadConversation(req, conversation) {
    const result = await chatAccessService.canAccessConversation({
        user: req.user,
        conversation,
        operationIds: [OPERATIONS.READ, OPERATIONS.READ_ALL],
        ipAddress: req.ip,
        allowGlobalAdmin: true
    });
    if (!result.allowed) {
        throw createHttpError(result.reason || 'Conversation is outside your chat access scope.', 403);
    }
    return result;
}

async function assertCanUpdateConversation(req, conversation) {
    const result = await chatAccessService.canAccessConversation({
        user: req.user,
        conversation,
        operationIds: [OPERATIONS.UPDATE],
        ipAddress: req.ip,
        allowGlobalAdmin: false
    });
    if (!result.allowed) {
        throw createHttpError(result.reason || 'You cannot update this conversation.', 403);
    }
    return result;
}

async function enrichConversations(conversations, currentUserId, requestingUser, updateAccess = {}) {
    const stateByConversationId = await chatContactScopeService.buildConversationContactStates(
        requestingUser,
        conversations
    );

    return conversations.map(c => {
        const state = stateByConversationId.get(String(c?.id)) || {
            canMessage: false,
            reason: chatContactScopeService.READ_ONLY_REASON,
            participants: []
        };
        const otherParticipant = c.participants.find(p => !idsEqual(p.userId, currentUserId));
        const participantState = state.participants.find((row) => idsEqual(row.userId, otherParticipant?.userId))
            || state.participants[0]
            || null;
        const userDetails = participantState?.user || null;
        const participantDisplay = participantState?.display || {};
        const canMessage = Boolean(updateAccess?.allowed && state.canMessage);
        const scopeReason = canMessage
            ? ''
            : (updateAccess?.allowed
                ? state.reason
                : (updateAccess?.reason || 'Your access profile does not allow sending chat messages.'));
        
        const myPart = c.participants.find(p => idsEqual(p.userId, currentUserId));
        const unreadCount = normalizeUnreadCount(myPart?.unreadCount);

        return {
            ...c,
            display: {
                name: participantDisplay.name || 'Unknown User',
                avatar: participantDisplay.avatar || null,
                status: userDetails ? (userDetails.status || 'offline') : 'offline',
                targetUserId: otherParticipant?.userId,
                org: participantDisplay.org || 'General',
                roles: participantDisplay.roles || [],
                roleLabels: participantDisplay.roleLabels || [],
                packages: participantDisplay.packages || [],
                canMessage,
                scopeReason
            },
            canMessage,
            scopeReason,
            unreadCount: unreadCount, 
            totalMessages: c.totalMessages || 0
        };
    });
}

/* ==========================================================================
   CONTROLLERS
   ========================================================================== */

// 1. ADMIN LIST
exports.listAllChats = async (req, res) => {
    try {
        const canViewGlobalChatList = await chatAccessService.isGlobalChatAdmin(req.user, req.ip);
        if (!canViewGlobalChatList) {
            return res.status(403).render('error', {
                title: 'Access Denied',
                message: 'Global conversation management requires full chat administration access.',
                user: req.user
            });
        }

        const allConvs = await chatRepository.list({
            query: {},
            scope: { canViewAll: true }
        });
        const allUsers = await dataService.getAccessibleUsers({ isSuperAdmin: true });
        const userMap = new Map(allUsers.map(u => [String(u.id), u]));

        const enriched = await Promise.all(allConvs.map(async (c) => {
            const participantNames = c.participants.map(p => {
                const u = userMap.get(String(p.userId));
                return u ? (u.name || u.username) : 'Unknown';
            }).join(', ');

            let totalBytes = 0;
            
            // A. JSON Msg File Size (Data Model Path)
            const msgFile = path.join(__dirname, '../../data/messages/', `${c.id}.json`);
            if (fs.existsSync(msgFile)) totalBytes += fs.statSync(msgFile).size;

            // B. Attachment Folder Size (Dynamic Path via Resolver)
            try {
                const root = coreFilesService.getRootPath('GLOBAL');
                const chatDir = coreFilesService.resolveSafePath(root, `chat/${c.id}`);
                totalBytes += getFolderSize(chatDir);
            } catch (e) {
                // Folder might not exist if no attachments were sent
            }

            return {
                id: c.id,
                participants: participantNames,
                msgCount: c.totalMessages || 0,
                sizeStr: formatBytes(totalBytes),
                updatedAt: c.updatedAt,
                startDate: c.updatedAt, 
                lastMsg: c.lastMessage ? c.lastMessage.content : 'No messages'
            };
        }));

        res.render('admin/chatList', {
            title: 'Conversation Management',
            tableName: 'System Conversations',
            data: enriched,
            newUrl: '', newLabel: '', includeModal: true, print: true, user: req.user, pagination: null, filters: {}
        });

    } catch (err) {
        res.status(500).render('error', { title: 'Error', message: err.message });
    }
};

// 2. UPLOAD ATTACHMENT
exports.uploadAttachment = async (req, res) => {
    try {
        // 1. Validate
        if (!req.files || req.files.length === 0) throw new Error("No files uploaded");
        if (!req.body.convId) throw new Error("Conversation ID missing");
        const conversation = await loadConversationOrThrow(req.body.convId);
        await assertCanUpdateConversation(req, conversation);

        // 2. Process
        // Multer (Middleware) + PathResolver have already saved the files 
        // to the correct folder. We just need to generate the URLs.
        
        const uploadedResults = req.files.map(file => ({
            status: 'success',
            // ✅ Derive URL dynamically from the file's actual location
            url: uploadMiddleware.getStoredFileUrl(file) || uploadMiddleware.getStoredFilePath(file),
            type: file.mimetype.startsWith('image/') ? 'image' : 'file',
            originalName: file.originalname
        }));

        res.json({ status: 'success', files: uploadedResults });

    } catch (err) {
        // Cleanup: If logic fails, try to delete the uploaded files
        if(req.files) {
            await uploadMiddleware.deleteUploadedFiles(req).catch(() => {});
        }
        console.error("Upload Logic Error:", err);
        res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
    }
};

// 3. DELETE CHAT
exports.deleteChat = async (req, res) => {
    try {
        const { convId } = req.params;
        const conversation = await loadConversationOrThrow(convId);
        const deleteAccess = await chatAccessService.canDeleteConversation(req.user, conversation, req.ip);
        if (!deleteAccess.allowed) {
            return res.status(403).json({
                status: 'error',
                message: deleteAccess.reason || 'You do not have permission to delete this conversation.'
            });
        }

        // ✅ USE RESOLVER to find the folder to delete
        const root = coreFilesService.getRootPath('GLOBAL');
        let filesDeleted = false;

        try {
            const configuredFolder = uploadFolderSettingsService.resolveUploadFolder('core.chat', {
                conversationId: convId
            });
            const defaultFolder = uploadFolderSettingsService.resolveDefaultUploadFolder('core.chat', {
                conversationId: convId
            });
            for (const relativePath of [...new Set([configuredFolder, defaultFolder])]) {
                // eslint-disable-next-line no-await-in-loop
                const removedUploadFolder = await fileAssetStorage.deleteRelativePath({
                    scopeKey: 'GLOBAL',
                    relativePath
                });
                if (removedUploadFolder) {
                    filesDeleted = true;
                    console.log(`[Chat] Deleted attachments for: ${convId}`);
                }
            }
            if (!filesDeleted) {
                // resolveSafePath ensures we don't accidentally delete outside our scope
                const chatDir = coreFilesService.resolveSafePath(root, `chat/${convId}`);
                if (fs.existsSync(chatDir)) {
                    await fsPromises.rm(chatDir, { recursive: true, force: true });
                    filesDeleted = true;
                    console.log(`[Chat] Deleted attachments for: ${convId}`);
                }
            }
        } catch (e) {
            // It's okay if the folder doesn't exist or is empty
            console.warn(`[Chat] File cleanup note for ${convId}:`, e.message);
        }

        const dataDeleted = await chatRepository.remove(convId);

        if (dataDeleted || filesDeleted) {
            res.json({ status: 'success', message: 'Conversation deleted' });
        } else {
            res.status(404).json({ status: 'error', message: 'Not found' });
        }
    } catch (err) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

// 4. STANDARD ACTIONS (No changes needed here)
exports.getInbox = async (req, res) => {
    try {
        const [rawConvs, updateAccess] = await Promise.all([
            chatRepository.getConversationsForUser(req.user.id),
            chatAccessService.canUseChatOperation(req.user, OPERATIONS.UPDATE, req.ip)
        ]);
        const enriched = await enrichConversations(rawConvs, req.user.id, req.user, updateAccess);
        const totalUnread = enriched.reduce(
            (sum, conversation) => sum + normalizeUnreadCount(conversation?.unreadCount),
            0
        );
        res.json({ status: 'success', data: enriched, totalUnread });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.getHistory = async (req, res) => {
    try {
        const convId = req.params.convId;
        const conversation = await loadConversationOrThrow(convId);
        await assertCanReadConversation(req, conversation);
        if (chatAccessService.conversationHasParticipant(conversation, req.user.id)) {
            await chatRepository.setLastRead(convId, req.user.id);
        }
        const [messages, writeAccess] = await Promise.all([
            chatRepository.getMessages(convId),
            chatAccessService.canAccessConversation({
                user: req.user,
                conversation,
                operationIds: [OPERATIONS.UPDATE],
                ipAddress: req.ip,
                allowGlobalAdmin: false
            })
        ]);
        res.json({
            status: 'success',
            data: messages,
            access: {
                canMessage: Boolean(writeAccess?.allowed),
                reason: writeAccess?.allowed
                    ? ''
                    : (writeAccess?.reason || 'This conversation is read-only.')
            }
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

exports.startChat = async (req, res) => {
    try {
        const { targetUserId } = req.body;
        if (!targetUserId) throw new Error("Target user required");
        if (idsEqual(targetUserId, req.user.id)) throw createHttpError('You cannot start a chat with yourself.', 400);
        await chatContactScopeService.assertCanContact(req.user, targetUserId);

        const conv = await chatRepository.create({ userIds: [req.user.id, targetUserId] });
        res.json({ status: 'success', conversationId: conv.id });
    } catch (err) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

exports.searchUsers = async (req, res) => {
    try {
        const results = await chatContactScopeService.searchContacts(
            req.user,
            req.query.q || '',
            { limit: 20 }
        );
        res.json({ status: 'success', data: results, results });
    } catch (err) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};
