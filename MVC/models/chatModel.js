// MVC/models/chatModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue'); 
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

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
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } catch (e) { return []; }
}

async function getMessages(convId) {
    try {
        const filePath = path.join(MSG_DIR, `${convId}.json`);
        const data = await fs.readFile(filePath, 'utf8').catch(() => '[]');
        return JSON.parse(data);
    } catch (e) { return []; }
}

async function createConversation(userIds) {
    return await queueWrite(async () => {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);

        // Check if exists
        const exists = all.find(c => 
            c.type === 'direct' && 
            c.participants.every(p => userIds.includes(String(p.userId)))
        );
        if (exists) return exists;

        const newConv = {
            id: `CONV_${Date.now()}`,
            type: 'direct',
            // Initialize unreadCount to 0 for everyone
            participants: userIds.map(id => ({ 
                userId: id, 
                lastRead: new Date(),
                unreadCount: 0  // <--- NEW FIELD
            })),
            lastMessage: null,
            totalMessages: 0, // <--- NEW FIELD
            updatedAt: new Date()
        };

        all.push(newConv);
        await fs.writeFile(CONV_FILE, JSON.stringify(all, null, 2));
        return newConv;
    });
}

async function addMessage(convId, senderId, content, type = 'text', fileUrl = null) {
    return await queueWrite(async () => {
        // 1. Update Message File
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        let messages = [];
        try { messages = JSON.parse(await fs.readFile(msgPath, 'utf8')); } catch {}

        const newMessage = {
            id: `MSG_${Date.now()}`,
            senderId,
            content,
            type,
            fileUrl: fileUrl || null,
            timestamp: new Date(),
            status: 'sent'
        };
        messages.push(newMessage);
        await fs.writeFile(msgPath, JSON.stringify(messages, null, 2));

        // 2. Update Conversation Registry
        const convData = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const allConv = JSON.parse(convData);
        const convIndex = allConv.findIndex(c => c.id === convId);
        
        if (convIndex > -1) {
            allConv[convIndex].lastMessage = {
                content: type === 'image' ? '📷 Image' : (type === 'file' ? '📎 File' : content),
                senderId,
                timestamp: newMessage.timestamp,
                status: 'sent'
            };
            allConv[convIndex].updatedAt = newMessage.timestamp;
            
            // ✅ NEW: Increment Total Messages
            allConv[convIndex].totalMessages = (allConv[convIndex].totalMessages || 0) + 1;

            // ✅ NEW: Increment Unread Count for RECIPIENTS (everyone except sender)
            allConv[convIndex].participants.forEach(p => {
                if (!idsEqual(p.userId, senderId)) {
                    p.unreadCount = (p.unreadCount || 0) + 1;
                } else {
                    // Sender read their own message
                    p.lastRead = newMessage.timestamp;
                    p.unreadCount = 0; 
                }
            });

            await fs.writeFile(CONV_FILE, JSON.stringify(allConv, null, 2));
        }

        return newMessage;
    });
}

// ✅ UPDATED: Reset Unread Count
async function setLastRead(convId, userId) {
    return await queueWrite(async () => {
        const data = await fs.readFile(CONV_FILE, 'utf8').catch(() => '[]');
        const all = JSON.parse(data);
        const convIndex = all.findIndex(c => c.id === convId);
        
        if (convIndex > -1) {
            const pIndex = all[convIndex].participants.findIndex(p => idsEqual(p.userId, userId));
            if (pIndex > -1) {
                all[convIndex].participants[pIndex].lastRead = new Date();
                all[convIndex].participants[pIndex].unreadCount = 0; // ✅ RESET TO 0
                await fs.writeFile(CONV_FILE, JSON.stringify(all, null, 2));
            }
        }
    });
}

async function updateMessageStatus(convId, messageId, newStatus) {
    return await queueWrite(async () => {
        const msgPath = path.join(MSG_DIR, `${convId}.json`);
        try {
            const messages = JSON.parse(await fs.readFile(msgPath, 'utf8'));
            const msgIndex = messages.findIndex(m => m.id === messageId);
            
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
        // Sort by newest update
        return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
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
        if (Array.isArray(result)) return result;
        if (result && Array.isArray(result.items)) return result.items;
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
        return merged;
    });
}

module.exports = { 
    getConversations,
    getMessages,
    createConversation,
    addMessage,
    updateMessageStatus,
    deleteConversation,
    setLastRead,
    getAllConversations,
    getConversationById,
    queryConversations,
    buildConversationQueryPlan,
    updateConversation
};
