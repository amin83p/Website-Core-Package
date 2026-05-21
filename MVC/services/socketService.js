// MVC/services/socketService.js
const socketIo = require('socket.io');
const chatRepository = require('../repositories/chatRepository');
const authService = require('./authService');
const chatAccessService = require('./chatAccessService');
const { OPERATIONS } = require('../../config/accessConstants');

let io;
const onlineUsers = new Map(); // Maps userId -> socketId

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
        return next();
    } catch (error) {
        return next(new Error(error?.message || 'Socket authentication failed.'));
    }
}

async function loadConversationForSocket(socket, convId, operationIds, allowGlobalAdmin = false) {
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
        onlineUsers.set(socket.userId, socket.id);
        console.log('Chat client connected:', socket.id, 'user:', socket.userId);

        // Legacy clients still emit identify; ignore the supplied user id to prevent spoofing.
        socket.on('identify', () => {
            onlineUsers.set(socket.userId, socket.id);
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

                const savedMsg = await chatRepository.addMessage(
                    data.convId,
                    socket.userId,
                    data.content,
                    data.type,
                    data.fileUrl
                );

                socket.emit('message_sent_ack', {
                    tempId: data.tempId,
                    realMsg: savedMsg
                });

                socket.to(String(data.convId)).emit('new_message', {
                    convId: data.convId,
                    message: savedMsg
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
            } catch (error) {
                console.error('Socket Read Status Error:', error);
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
            if (socket.userId) onlineUsers.delete(socket.userId);
        });
    });

    return io;
}

function getIo() {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
}

module.exports = { init, getIo };
