// MVC/services/socketService.js
const socketIo = require('socket.io');
const chatRepository = require('../repositories/chatRepository');
const authService = require('./authService');
const chatAccessService = require('./chatAccessService');
const { OPERATIONS } = require('../../config/accessConstants');

let io;
const onlineUsers = new Map(); // Maps userId -> Set<socketId>

function getUserRoom(userId) {
    return `chat:user:${String(userId || '').trim()}`;
}

function trackOnlineSocket(userId, socketId) {
    const key = String(userId || '').trim();
    if (!key) return;
    const sockets = onlineUsers.get(key) || new Set();
    sockets.add(socketId);
    onlineUsers.set(key, sockets);
}

function untrackOnlineSocket(userId, socketId) {
    const key = String(userId || '').trim();
    const sockets = onlineUsers.get(key);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) onlineUsers.delete(key);
}

async function getUnreadPayload(userId, convId) {
    const summary = await chatRepository.getUnreadSummaryForUser(userId);
    return {
        convId: String(convId || ''),
        unreadCount: Number(summary?.byConversation?.[String(convId)]) || 0,
        totalUnread: Number(summary?.totalUnread) || 0
    };
}

async function emitUnreadState(userId, convId) {
    const payload = await getUnreadPayload(userId, convId);
    io.to(getUserRoom(userId)).emit('unread_state', payload);
    return payload;
}

function resolveRecipientIds({ conversation, senderId, recipientIds } = {}) {
    if (Array.isArray(recipientIds) && recipientIds.length) {
        return [...new Set(recipientIds
            .map((userId) => String(userId || '').trim())
            .filter((userId) => userId && userId !== String(senderId || '').trim()))];
    }
    return [...new Set((Array.isArray(conversation?.participants)
        ? conversation.participants
        : [])
        .map((participant) => String(participant?.userId || '').trim())
        .filter((userId) => userId && userId !== String(senderId || '').trim()))];
}

async function emitNewMessageToRecipients({
    conversation = null,
    convId = '',
    message = null,
    senderId = '',
    recipientIds = null
} = {}) {
    if (!io || !message) return { recipientIds: [] };
    const effectiveConvId = String(convId || conversation?.id || '').trim();
    if (!effectiveConvId) return { recipientIds: [] };

    const recipients = resolveRecipientIds({
        conversation,
        senderId,
        recipientIds
    });
    if (!recipients.length) return { recipientIds: [] };

    await Promise.all(recipients.map(async (recipientId) => {
        let unread = null;
        try {
            unread = await getUnreadPayload(recipientId, effectiveConvId);
        } catch (summaryError) {
            console.error('Socket Unread Summary Error:', summaryError);
        }
        io.to(getUserRoom(recipientId)).emit('new_message', {
            convId: effectiveConvId,
            message,
            unreadCount: unread?.unreadCount,
            totalUnread: unread?.totalUnread
        });
    }));

    return { recipientIds: recipients };
}

async function emitMessagesDeleted({ convId = '', messageIds = [], deletedByUserId = '' } = {}) {
    if (!io || !convId || !Array.isArray(messageIds) || !messageIds.length) return;
    io.to(String(convId)).emit('message_deleted', {
        convId: String(convId),
        messageIds: messageIds.map((id) => String(id)),
        deletedByUserId: String(deletedByUserId || '')
    });
}

function buildReplySnapshot(message = null) {
    if (!message) return null;
    const type = String(message?.type || 'text');
    const preview = message?.deletedAt
        ? 'Message deleted'
        : (type === 'image' ? 'Image' : (type === 'file' ? 'Attachment' : String(message?.content || '').slice(0, 240)));
    return {
        messageId: String(message.id || ''),
        senderId: String(message.senderId || ''),
        type,
        preview
    };
}

function parseCookies(cookieHeader = '') {
    const out = {};
    String(cookieHeader || '').split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx <= 0) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!key) return;
        try {
            out[key] = decodeURIComponent(value);
        } catch (_) {
            out[key] = value;
        }
    });
    return out;
}

async function authenticateSocket(socket, next) {
    try {
        const cookies = parseCookies(socket.handshake?.headers?.cookie || '');
        const token = cookies.auth_token;
        if (!token || !authService.validateToken(token)) {
            return next(new Error('Authentication required.'));
        }

        const user = await authService.getUserFromToken(token);
        const readAccess = await chatAccessService.canUseChatOperation(
            user,
            [OPERATIONS.READ, OPERATIONS.READ_ALL],
            socket.handshake?.address
        );
        if (!readAccess.allowed) {
            return next(new Error(readAccess.reason || 'Chat access denied.'));
        }

        socket.user = user;
        socket.userId = String(user.id);
        socket.authToken = token;
        return next();
    } catch (error) {
        return next(new Error(error?.message || 'Socket authentication failed.'));
    }
}

async function loadConversationForSocket(socket, convId, operationIds, allowGlobalAdmin = false) {
    if (socket.authToken) {
        const refreshedUser = await authService.getUserFromToken(socket.authToken);
        socket.user = refreshedUser;
        socket.userId = String(refreshedUser.id);
    }
    const conversation = await chatRepository.getById(convId);
    if (!conversation) {
        return {
            allowed: false,
            reason: 'Conversation not found.'
        };
    }

    const access = await chatAccessService.canAccessConversation({
        user: socket.user,
        conversation,
        operationIds,
        ipAddress: socket.handshake?.address,
        allowGlobalAdmin
    });

    if (!access.allowed) return access;
    return {
        ...access,
        conversation
    };
}

function emitChatError(socket, message) {
    socket.emit('chat_error', { message });
}

function init(server) {
    io = socketIo(server);
    io.use(authenticateSocket);

    io.on('connection', (socket) => {
        trackOnlineSocket(socket.userId, socket.id);
        socket.join(getUserRoom(socket.userId));
        console.log('Chat client connected:', socket.id, 'user:', socket.userId);

        // Legacy clients still emit identify; ignore the supplied user id to prevent spoofing.
        socket.on('identify', () => {
            trackOnlineSocket(socket.userId, socket.id);
            socket.join(getUserRoom(socket.userId));
        });

        socket.on('join_room', async (convId) => {
            try {
                const access = await loadConversationForSocket(
                    socket,
                    convId,
                    [OPERATIONS.READ, OPERATIONS.READ_ALL],
                    false
                );
                if (!access.allowed) return emitChatError(socket, access.reason || 'Unable to join conversation.');
                socket.join(String(convId));
                console.log(`User ${socket.userId} joined room ${convId}`);
            } catch (error) {
                console.error('Socket Join Error:', error);
                emitChatError(socket, 'Unable to join conversation.');
            }
        });

        socket.on('send_message', async (data = {}) => {
            try {
                const access = await loadConversationForSocket(
                    socket,
                    data.convId,
                    [OPERATIONS.UPDATE],
                    false
                );
                if (!access.allowed) {
                    return emitChatError(socket, access.reason || 'You cannot send messages in this conversation.');
                }

                let replyTo = null;
                const replyToMessageId = String(data.replyToMessageId || '').trim();
                if (replyToMessageId) {
                    const target = await chatRepository.getMessage(data.convId, replyToMessageId);
                    if (!target) return emitChatError(socket, 'The message you are replying to no longer exists.');
                    replyTo = buildReplySnapshot(target);
                }

                const savedMsg = await chatRepository.addMessage(
                    data.convId,
                    socket.userId,
                    data.content,
                    data.type,
                    data.fileUrl,
                    { replyTo }
                );

                socket.emit('message_sent_ack', {
                    tempId: data.tempId,
                    realMsg: savedMsg
                });
                await emitNewMessageToRecipients({
                    conversation: access.conversation,
                    convId: data.convId,
                    message: savedMsg,
                    senderId: socket.userId
                });
            } catch (err) {
                console.error('Socket Message Error:', err);
                emitChatError(socket, 'Failed to send message.');
            }
        });

        socket.on('mark_delivered', async (data = {}) => {
            try {
                const access = await loadConversationForSocket(
                    socket,
                    data.convId,
                    [OPERATIONS.READ, OPERATIONS.READ_ALL],
                    false
                );
                if (!access.allowed) return;
                await chatRepository.updateMessageStatus(data.convId, data.messageId, 'delivered');
                socket.to(String(data.convId)).emit('status_update', { messageId: data.messageId, status: 'delivered' });
            } catch (error) {
                console.error('Socket Delivery Status Error:', error);
            }
        });

        socket.on('mark_read', async (data = {}) => {
            try {
                const access = await loadConversationForSocket(
                    socket,
                    data.convId,
                    [OPERATIONS.READ, OPERATIONS.READ_ALL],
                    false
                );
                if (!access.allowed) return;
                await chatRepository.updateMessageStatus(data.convId, data.messageId, 'read');
                socket.to(String(data.convId)).emit('status_update', { messageId: data.messageId, status: 'read' });
                if (chatAccessService.conversationHasParticipant(access.conversation, socket.userId)) {
                    await chatRepository.setLastRead(data.convId, socket.userId);
                    await emitUnreadState(socket.userId, data.convId);
                }
            } catch (error) {
                console.error('Socket Read Status Error:', error);
            }
        });

        socket.on('mark_conversation_read', async (data = {}) => {
            try {
                const access = await loadConversationForSocket(
                    socket,
                    data.convId,
                    [OPERATIONS.READ, OPERATIONS.READ_ALL],
                    false
                );
                if (!access.allowed) return;
                if (!chatAccessService.conversationHasParticipant(access.conversation, socket.userId)) return;

                await chatRepository.setLastRead(data.convId, socket.userId);
                if (data.messageId) {
                    await chatRepository.updateMessageStatus(data.convId, data.messageId, 'read');
                    socket.to(String(data.convId)).emit('status_update', {
                        messageId: data.messageId,
                        status: 'read'
                    });
                }
                await emitUnreadState(socket.userId, data.convId);
            } catch (error) {
                console.error('Socket Conversation Read Error:', error);
            }
        });

        socket.on('conversation_deleted', async (data = {}) => {
            try {
                const conversation = await chatRepository.getById(data.convId);
                const access = await chatAccessService.canDeleteConversation(
                    socket.user,
                    conversation,
                    socket.handshake?.address
                );
                if (!access.allowed) return;
                socket.to(String(data.convId)).emit('on_conversation_deleted', {
                    convId: data.convId
                });
            } catch (error) {
                console.error('Socket Delete Broadcast Error:', error);
            }
        });

        socket.on('disconnect', () => {
            if (socket.userId) untrackOnlineSocket(socket.userId, socket.id);
        });
    });

    return io;
}

function getIo() {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
}

module.exports = { init, getIo, emitNewMessageToRecipients, emitMessagesDeleted };
