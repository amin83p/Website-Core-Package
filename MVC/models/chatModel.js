// MVC/models/chatModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue'); 
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const {
    normalizeMessage,
    normalizeConversation,
    applyMessageToConversation,
    markConversationRead,
    buildUnreadSummary
} = require('../services/chatUnreadStateService');
const { paginateChatMessages } = require('../services/chatMessagePaginationService');

const CONV_FILE = path.join(__dirname, '../../data/conversations.json');
const MSG_DIR = path.join(__dirname, '../../data/messages/');

// Ensure directories exist
if (!fsSync.existsSync(MSG_DIR)) fsSync.mkdirSync(MSG_DIR, { recursive: true });

async function getConversations(userId) {
    try {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);
        return all
            .filter(c => c.participants.some(p => idsEqual(p.userId, userId)))
            .map(normalizeConversation)
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } catch (e) { return []; }
}

async function getMessages(convId, options = {}) {
    try {
        const filePath = path.join(MSG_DIR, `${convId}.json`);
        const data = await fs.readFile(filePath, 'utf8').catch(() => '[]');
        const messages = JSON.parse(data).map((message) => normalizeMessage(message));
        return paginateChatMessages(messages, options);
    } catch (e) {
        return paginateChatMessages([], options);
    }
}

async function getMessage(convId, messageId) {
    try {
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        const messages = JSON.parse(await fs.readFile(msgPath, 'utf8'));
        return messages.map((message) => normalizeMessage(message))
            .find((message) => idsEqual(message?.id, messageId)) || null;
    } catch (_) {
        return null;
    }
}

function attachmentReferenceMatches(fileUrl, fileName) {
    if (!fileUrl || !fileName) return false;
    const reference = String(fileUrl).split('?')[0].split('#')[0];
    const referencedName = reference.split('/').pop() || '';
    try {
        return decodeURIComponent(referencedName) === String(fileName);
    } catch (_) {
        return referencedName === String(fileName);
    }
}

async function hasActiveAttachment(convId, fileName) {
    try {
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        const messages = JSON.parse(await fs.readFile(msgPath, 'utf8'));
        return messages.some((message) => (
            !message?.deletedAt && attachmentReferenceMatches(message?.fileUrl, fileName)
        ));
    } catch (_) {
        return false;
    }
}

function summarizeMessages(messages = []) {
    const active = (Array.isArray(messages) ? messages : []).filter((message) => message?.deletedAt == null);
    const last = active.slice().sort((left, right) => (
        new Date(right?.timestamp || 0).getTime() - new Date(left?.timestamp || 0).getTime()
    ))[0] || null;
    return {
        totalMessages: active.length,
        lastMessage: last ? {
            content: last.type === 'image' ? 'Image' : (last.type === 'file' ? 'File' : String(last.content || '')),
            senderId: toPublicId(last.senderId),
            timestamp: last.timestamp,
            status: last.status || 'sent',
            type: last.type || 'text'
        } : null,
        lastMessageAt: last?.timestamp || null
    };
}

async function softDeleteMessages(convId, messageIds = [], options = {}) {
    return await queueWrite(async () => {
        const targetIds = new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id || '').trim()).filter(Boolean));
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        let messages = [];
        try { messages = JSON.parse(await fs.readFile(msgPath, 'utf8')); } catch {}
        const found = messages.filter((message) => targetIds.has(String(message?.id || '')));
        if (found.length !== targetIds.size) throw new Error('One or more messages were not found.');

        const now = new Date().toISOString();
        messages = messages.map((message) => {
            if (!targetIds.has(String(message?.id || '')) || message?.deletedAt) return message;
            return {
                ...message,
                content: 'Message deleted',
                fileUrl: null,
                deletedAt: now,
                deletedByUserId: toPublicId(options?.deletedByUserId),
                deletionScope: String(options?.scopeMode || '')
            };
        });
        await fs.writeFile(msgPath, JSON.stringify(messages, null, 2));

        const convData = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const conversations = JSON.parse(convData);
        const convIndex = conversations.findIndex((conversation) => idsEqual(conversation?.id, convId));
        if (convIndex > -1) {
            conversations[convIndex] = {
                ...conversations[convIndex],
                ...summarizeMessages(messages),
                updatedAt: now
            };
            await fs.writeFile(CONV_FILE, JSON.stringify(conversations, null, 2));
        }
        return { messageIds: [...targetIds], deletedAt: now };
    });
}

async function createConversation(userIds) {
    return await queueWrite(async () => {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);
        const normalizedUserIds = userIds.map((id) => toPublicId(id)).filter(Boolean);

        // Check if exists
        const exists = all.find(c => 
            c.type === 'direct' && 
            Array.isArray(c.participants) &&
            c.participants.length === normalizedUserIds.length &&
            c.participants.every(p => normalizedUserIds.some((id) => idsEqual(id, p.userId)))
        );
        if (exists) return normalizeConversation(exists);

        const now = new Date().toISOString();

        const newConv = {
            id: `CONV_${Date.now()}`,
            type: 'direct',
            participants: normalizedUserIds.map(id => ({
                userId: id, 
                lastRead: now,
                unreadCount: 0
            })),
            lastMessage: null,
            totalMessages: 0,
            createdAt: now,
            updatedAt: now
        };

        all.push(newConv);
        await fs.writeFile(CONV_FILE, JSON.stringify(all, null, 2));
        return normalizeConversation(newConv);
    });
}

async function addMessage(convId, senderId, content, type = 'text', fileUrl = null, options = {}) {
    return await queueWrite(async () => {
        // 1. Update Message File
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        let messages = [];
        try { messages = JSON.parse(await fs.readFile(msgPath, 'utf8')); } catch {}

        const newMessage = {
            id: `MSG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            senderId: toPublicId(senderId),
            content: String(content || ''),
            type: String(type || 'text'),
            fileUrl: fileUrl || null,
            replyTo: options?.replyTo || null,
            timestamp: new Date().toISOString(),
            status: 'sent'
        };
        messages.push(newMessage);
        await fs.writeFile(msgPath, JSON.stringify(messages, null, 2));

        // 2. Update Conversation Registry
        const convData = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const allConv = JSON.parse(convData);
        const convIndex = allConv.findIndex(c => c.id === convId);
        
        if (convIndex > -1) {
            allConv[convIndex] = applyMessageToConversation(
                allConv[convIndex],
                senderId,
                newMessage
            );
            await fs.writeFile(CONV_FILE, JSON.stringify(allConv, null, 2));
        }

        return normalizeMessage(newMessage);
    });
}

async function setLastRead(convId, userId) {
    return await queueWrite(async () => {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);
        const convIndex = all.findIndex(c => c.id === convId);
        
        if (convIndex > -1) {
            all[convIndex] = markConversationRead(all[convIndex], userId);
            await fs.writeFile(CONV_FILE, JSON.stringify(all, null, 2));
            return true;
        }
        return false;
    });
}

async function updateMessageStatus(convId, messageId, newStatus) {
    return await queueWrite(async () => {
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        try {
            const messages = JSON.parse(await fs.readFile(msgPath, 'utf8'));
            const msgIndex = messages.findIndex(m => idsEqual(m?.id, messageId));
            
            if (msgIndex > -1) {
                const current = messages[msgIndex].status;
                if (current === 'read') return null;
                if (current === 'delivered' && newStatus === 'sent') return null;

                messages[msgIndex].status = newStatus;
                await fs.writeFile(msgPath, JSON.stringify(messages, null, 2));
                return messages[msgIndex];
            }
        } catch (e) { }
        return null;
    });
}

async function deleteConversation(convId) {
    return await queueWrite(async () => {
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        try { await fs.unlink(msgPath); } catch (e) {}

        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        let all = JSON.parse(data);
        
        const initialLength = all.length;
        all = all.filter(c => !idsEqual(c?.id, convId));
        
        if (all.length !== initialLength) {
            await fs.writeFile(CONV_FILE, JSON.stringify(all, null, 2));
            return true;
        }
        return false;
    });
}

async function getAllConversations() {
    try {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);
        return all
            .map(normalizeConversation)
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } catch (e) { return []; }
}

async function getConversationById(convId) {
    const all = await getAllConversations();
    return all.find((c) => idsEqual(c?.id, convId)) || null;
}

function applyConversationScope(rows, scope = {}) {
    const list = Array.isArray(rows) ? rows : [];
    if (scope?.canViewAll === true) return list;
    const scopedUserId = toPublicId(scope?.userId);
    if (!scopedUserId) return [];
    return list.filter((conversation) => {
        const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
        return participants.some((participant) => idsEqual(participant?.userId, scopedUserId));
    });
}

function buildConversationQueryPlan(options = {}) {
    const query = options?.query || {};
    const incomingScope = options?.scope || {};

    return {
        entity: 'chatConversations',
        query,
        scope: {
            canViewAll: incomingScope?.canViewAll === true,
            userId: toPublicId(incomingScope?.userId) || null
        },
        projection: options?.projection || null,
        pagination: options?.pagination || null,
        sort: options?.sort || null,
        fallback: {
            defaultSearchFields: [
                'id',
                'type',
                'participants.userId',
                'lastMessage.content',
                'lastMessage.senderId'
            ],
            dateFields: ['updatedAt', 'lastMessage.timestamp']
        }
    };
}

async function queryConversations(options = {}) {
    const plan = buildConversationQueryPlan(options);
    const executor = getEntityQueryExecutor('chatConversations');

    if (typeof executor === 'function') {
        const result = await executor(plan);
        if (Array.isArray(result)) return result.map(normalizeConversation);
        if (result && Array.isArray(result.items)) return result.items.map(normalizeConversation);
    }

    const all = await getAllConversations();
    const scoped = applyConversationScope(all, plan.scope);
    return applyGenericFilter(scoped, plan.query, plan.fallback);
}

async function updateConversation(convId, updates) {
    return await queueWrite(async () => {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);
        const index = all.findIndex((c) => idsEqual(c?.id, convId));
        if (index === -1) throw new Error('Conversation not found.');

        const current = all[index] || {};
        const merged = {
            ...current,
            ...(updates || {}),
            id: current.id,
            participants: Array.isArray(updates?.participants) ? updates.participants : current.participants
        };
        all[index] = merged;
        await fs.writeFile(CONV_FILE, JSON.stringify(all, null, 2));
        return normalizeConversation(merged);
    });
}

async function getUnreadSummaryForUser(userId) {
    const conversations = await getConversations(userId);
    return buildUnreadSummary(conversations, userId);
}

module.exports = {
    getConversations,
    getMessages,
    getMessage,
    hasActiveAttachment,
    createConversation,
    addMessage,
    updateMessageStatus,
    deleteConversation,
    softDeleteMessages,
    setLastRead,
    getAllConversations,
    getConversationById,
    queryConversations,
    buildConversationQueryPlan,
    updateConversation,
    getUnreadSummaryForUser
};
