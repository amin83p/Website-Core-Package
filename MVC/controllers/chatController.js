// MVC/controllers/chatController.js
const chatRepository = require('../repositories/chatRepository');
const { idsEqual } = require('../utils/idAdapter');

const dataService = require('../services/dataService'); 
const chatAccessService = require('../services/chatAccessService');
const pathResolver = require('../utils/pathResolver'); // ✅ Import Resolver
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { normalizeSearchKeyword } = require('../utils/generalTools');
const { OPERATIONS } = require('../../config/accessConstants');
const uploadMiddleware = require('../middleware/upload');
const fileAssetStorage = require('../services/fileAssetStorageService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');

/* ==========================================================================
   HELPERS
   ========================================================================== */

// Helper: Convert Physical Disk Path to Web URL
// Example: "C:\App\uploads\GLOBAL\chat\123.jpg" -> "/uploads/GLOBAL/chat/123.jpg"
function zzzgetWebUrlFromFile(physicalPath) {
    const amin = pathResolver.getWebUrlForUpload(physicalPath);
    console.log('1: ',amin);
    // 1. Get the Project Root Uploads directory
    // We derive this by going up one level from the 'GLOBAL' root defined in resolver
    const uploadsRoot = path.resolve(pathResolver.getRootPath('GLOBAL'), '..');
    
    // 2. Get relative path from uploads folder
    const relative = path.relative(uploadsRoot, physicalPath);
    
    // 3. Normalize slashes for Web URL (Windows backslash -> Forward slash)
    const urlPath = relative.split(path.sep).join('/');
    
    console.log('2: ','/uploads/' + urlPath);
    return '/uploads/' + urlPath;
}

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

// Helper: Enrich conversation participants
async function buildPersonAvatarMap(users, requestingUser) {
    const personIds = Array.from(new Set(
        (Array.isArray(users) ? users : [])
            .map((u) => String(u?.personId || '').trim())
            .filter(Boolean)
    ));
    if (!personIds.length) return new Map();

    const persons = await dataService.fetchData('persons', {}, requestingUser);
    const map = new Map();
    (Array.isArray(persons) ? persons : []).forEach((p) => {
        const pid = String(p?.id || '').trim();
        if (!pid) return;
        map.set(pid, String(p?.avatarUrl || '').trim() || null);
    });
    return map;
}

function resolveUserAvatar(userDetails, personAvatarMap) {
    const directAvatar = String(userDetails?.avatar || userDetails?.avatarUrl || '').trim();
    if (directAvatar) return directAvatar;
    const personId = String(userDetails?.personId || '').trim();
    if (!personId) return null;
    return personAvatarMap.get(personId) || null;
}

async function enrichConversations(conversations, currentUserId, requestingUser) {
    const allUsers = await dataService.getAccessibleUsers(requestingUser || { isSuperAdmin: true });
    const userMap = new Map(allUsers.map(u => [String(u.id), u]));
    const personAvatarMap = await buildPersonAvatarMap(allUsers, requestingUser);

    return conversations.map(c => {
        const otherParticipant = c.participants.find(p => !idsEqual(p.userId, currentUserId));
        const userDetails = userMap.get(String(otherParticipant?.userId));
        
        const myPart = c.participants.find(p => idsEqual(p.userId, currentUserId));
        const unreadCount = myPart ? (myPart.unreadCount || 0) : 0;

        return {
            ...c,
            display: {
                name: userDetails ? (userDetails.username || userDetails.email) : 'Unknown User',
                avatar: resolveUserAvatar(userDetails, personAvatarMap),
                status: userDetails ? (userDetails.status || 'offline') : 'offline',
                targetUserId: otherParticipant?.userId
            },
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
                const root = pathResolver.getRootPath('GLOBAL');
                const chatDir = pathResolver.resolveSafePath(root, `chat/${c.id}`);
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
        const root = pathResolver.getRootPath('GLOBAL');
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
                const chatDir = pathResolver.resolveSafePath(root, `chat/${convId}`);
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
        const rawConvs = await chatRepository.getConversationsForUser(req.user.id);
        const enriched = await enrichConversations(rawConvs, req.user.id, req.user);
        res.json({ status: 'success', data: enriched });
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
        const messages = await chatRepository.getMessages(convId);
        res.json({ status: 'success', data: messages });
    } catch (err) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

exports.startChat = async (req, res) => {
    try {
        const { targetUserId } = req.body;
        if (!targetUserId) throw new Error("Target user required");
        if (idsEqual(targetUserId, req.user.id)) throw createHttpError('You cannot start a chat with yourself.', 400);

        const targetRows = await dataService.fetchData('users', {
            q: String(targetUserId),
            type: 'exact_match',
            searchFields: 'id',
            page: 1,
            limit: 1
        }, req.user);
        if (!Array.isArray(targetRows) || targetRows.length === 0) {
            throw createHttpError('Selected user is outside your access scope.', 403);
        }

        const conv = await chatRepository.create({ userIds: [req.user.id, targetUserId] });
        res.json({ status: 'success', conversationId: conv.id });
    } catch (err) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

exports.searchUsers1 = async (req, res) => {
    try {
        const query = req.query.q || '';
        const currentUserId = req.user.id;
        const allUsers = await dataService.getAccessibleUsers(req.user);
        
        const filtered = allUsers.filter(u => {
            if (idsEqual(u.id, currentUserId)) return false;
            const searchStr = (u.username + ' ' + (u.email || '') + ' ' + (u.name || '')).toLowerCase();
            return searchStr.includes(query.toLowerCase());
        });

        const results = filtered.map(u => ({
            id: u.id,
            name: u.name || u.username,
            avatar: u.avatar || null,
            email: u.email,
            org: u.organizations && u.organizations.length > 0 ? u.organizations[0].name : 'General'
        })).slice(0, 20); 

        res.json({ status: 'success', data: results });

    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.searchUsers = async (req, res) => {
    try {
        const currentUserId = req.user.id;
        // 1. Build the query parameters for the generic filter engine
        const queryParams = {
            q: normalizeSearchKeyword(req.query.q || ''),
            searchFields: 'username,email,personId,id' // Target specific fields
        };

        // 2. Fetch and filter data simultaneously using the Data Service
        const filteredUsers = await dataService.fetchData('users', queryParams, req.user);
        const personAvatarMap = await buildPersonAvatarMap(filteredUsers, req.user);

        // 3. Format the results for the chat sidebar and exclude the current user
        const results = filteredUsers
            .filter(u => !idsEqual(u.id, currentUserId))
            .map(u => ({
                id: u.id,
                name: u.identity?.displayName || u.name || u.username,
                avatar: resolveUserAvatar(u, personAvatarMap),
                email: u.email,
                org: u.organizations && u.organizations.length > 0 ? u.organizations[0].name : 'General'
            }))
            .slice(0, 20); 

        res.json({ status: 'success', data: results, results });

    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
