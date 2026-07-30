const chatModel = require('../models/chatModel');
const { toPublicId } = require('../utils/idAdapter');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const {
  normalizeMessage,
  normalizeConversation,
  buildUnreadSummary
} = require('../services/chatUnreadStateService');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = require('./backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildChatScopeFilter(scope = {}) {
  if (scope?.canViewAll === true) return {};
  const userId = toPublicId(scope?.userId);
  if (!userId) return { id: '__NO_MATCH__' };
  return { 'participants.userId': userId };
}

async function listMongoConversations(options = {}) {
  const collection = getMongoCollection('chatConversations');
  const query = options?.query || {};
  const scopeFilter = buildChatScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'title', 'participants.userId', 'participants.name'],
    dateFields: ['createdAt', 'updatedAt', 'lastMessageAt']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { lastMessageAt: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows
    .map(normalizeMongoDocument)
    .filter(Boolean)
    .map(normalizeConversation);
}

function normalizeChatDocument(row) {
  const normalized = normalizeMongoDocument(row);
  return normalized ? normalizeConversation(normalized) : null;
}

const chatRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return chatModel.queryConversations({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoConversations(options)
    }, 'core.chat.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) ? rows.length : 0;
  },

  async exists(options = {}) {
    const query = {
      ...(stripPaginationFromQuery(options?.query || {})),
      page: 1,
      limit: 1
    };
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) && rows.length > 0;
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.getConversationById(id),
      mongo: async () => normalizeChatDocument(
        await getMongoCollection('chatConversations').findOne(resolveMongoIdFilter(id))
      )
    }, 'core.chat.getById');
  },

  async create(data = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const userIds = Array.isArray(data?.userIds) ? data.userIds : [];
        if (!userIds.length) throw new Error('Conversation participants are required.');
        return chatModel.createConversation(userIds.map((id) => toPublicId(id)).filter(Boolean));
      },
      mongo: async () => {
        const userIds = Array.isArray(data?.userIds) ? data.userIds.map((id) => toPublicId(id)).filter(Boolean) : [];
        if (!userIds.length) throw new Error('Conversation participants are required.');
        const collection = getMongoCollection('chatConversations');
        const now = new Date().toISOString();
        const payload = {
          ...(data || {}),
          type: String(data?.type || 'direct'),
          participants: Array.isArray(data?.participants)
            ? data.participants.map((participant) => ({
                ...(participant || {}),
                userId: toPublicId(participant?.userId),
                lastRead: participant?.lastRead || now,
                unreadCount: 0
              }))
            : userIds.map((id) => ({ userId: id, lastRead: now, unreadCount: 0 })),
          messages: Array.isArray(data?.messages)
            ? data.messages.map((message) => normalizeMessage(message))
            : [],
          lastMessage: data?.lastMessage ? normalizeMessage(data.lastMessage) : null,
          totalMessages: Array.isArray(data?.messages) ? data.messages.length : 0,
          createdAt: data?.createdAt || now,
          updatedAt: data?.updatedAt || now
        };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeChatDocument(payload);
      }
    }, 'core.chat.create');
  },

  async update(id, data = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.updateConversation(id, data),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Conversation not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeChatDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.chat.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.deleteConversation(id),
      mongo: async () => getMongoCollection('chatConversations').deleteOne(resolveMongoIdFilter(id))
    }, 'core.chat.remove');
  },

  async getMessages(convId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.getMessages(convId),
      mongo: async () => {
        const row = await getMongoCollection('chatConversations').findOne(resolveMongoIdFilter(convId), { projection: { messages: 1 } });
        return Array.isArray(row?.messages)
          ? row.messages.map((message) => normalizeMessage(message))
          : [];
      }
    }, 'core.chat.getMessages');
  },

  async addMessage(convId, senderId, content, type = 'text', fileUrl = null, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.addMessage(convId, senderId, content, type, fileUrl),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const timestamp = new Date().toISOString();
        const senderKey = toPublicId(senderId);
        const message = {
          id: `MSG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          senderId: senderKey,
          content: String(content || ''),
          type: String(type || 'text'),
          fileUrl: fileUrl || null,
          status: 'sent',
          timestamp
        };
        const existingMessages = {
          $cond: [{ $isArray: '$messages' }, '$messages', []]
        };
        const existingParticipants = {
          $cond: [{ $isArray: '$participants' }, '$participants', []]
        };
        const participantIsSender = {
          $eq: [
            {
              $convert: {
                input: '$$participant.userId',
                to: 'string',
                onError: '',
                onNull: ''
              }
            },
            senderKey
          ]
        };
        const result = await collection.updateOne(
          resolveMongoIdFilter(convId),
          [{
            $set: {
              messages: {
                $concatArrays: [existingMessages, { $literal: [message] }]
              },
              participants: {
                $map: {
                  input: existingParticipants,
                  as: 'participant',
                  in: {
                    $mergeObjects: [
                      '$$participant',
                      {
                        unreadCount: {
                          $cond: [
                            participantIsSender,
                            0,
                            {
                              $add: [
                                {
                                  $convert: {
                                    input: '$$participant.unreadCount',
                                    to: 'int',
                                    onError: 0,
                                    onNull: 0
                                  }
                                },
                                1
                              ]
                            }
                          ]
                        },
                        lastRead: {
                          $cond: [
                            participantIsSender,
                            timestamp,
                            '$$participant.lastRead'
                          ]
                        }
                      }
                    ]
                  }
                }
              },
              lastMessage: {
                $literal: {
                  content: message.type === 'image'
                    ? 'Image'
                    : (message.type === 'file' ? 'File' : message.content),
                  senderId: senderKey,
                  timestamp,
                  status: 'sent',
                  type: message.type
                }
              },
              lastMessageAt: timestamp,
              totalMessages: {
                $add: [{ $size: existingMessages }, 1]
              },
              updatedAt: timestamp
            }
          }]
        );
        if (!result?.matchedCount) throw new Error('Conversation not found');
        return normalizeMessage(message);
      }
    }, 'core.chat.addMessage');
  },

  async setLastRead(convId, userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.setLastRead(convId, userId),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const key = toPublicId(userId);
        const stamp = new Date().toISOString();
        const participantIsUser = {
          $eq: [
            {
              $convert: {
                input: '$$participant.userId',
                to: 'string',
                onError: '',
                onNull: ''
              }
            },
            key
          ]
        };
        const result = await collection.updateOne(
          resolveMongoIdFilter(convId),
          [{
            $set: {
              participants: {
                $map: {
                  input: {
                    $cond: [{ $isArray: '$participants' }, '$participants', []]
                  },
                  as: 'participant',
                  in: {
                    $cond: [
                      participantIsUser,
                      {
                        $mergeObjects: [
                          '$$participant',
                          { lastRead: stamp, unreadCount: 0 }
                        ]
                      },
                      {
                        $mergeObjects: [
                          '$$participant',
                          {
                            unreadCount: {
                              $convert: {
                                input: '$$participant.unreadCount',
                                to: 'int',
                                onError: 0,
                                onNull: 0
                              }
                            }
                          }
                        ]
                      }
                    ]
                  }
                }
              }
            }
          }]
        );
        if (!result?.matchedCount) throw new Error('Conversation not found');
        return true;
      }
    }, 'core.chat.setLastRead');
  },

  async updateMessageStatus(convId, messageId, newStatus, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.updateMessageStatus(convId, messageId, newStatus),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const normalizedMessageId = toPublicId(messageId);
        const messageIdCandidates = [normalizedMessageId];
        if (/^\d+$/.test(normalizedMessageId)) {
          messageIdCandidates.push(Number(normalizedMessageId));
        }
        const status = String(newStatus || '').trim() || 'sent';
        const stamp = new Date().toISOString();
        const result = await collection.updateOne(
          {
            ...resolveMongoIdFilter(convId),
            'messages.id': { $in: messageIdCandidates }
          },
          {
            $set: {
              'messages.$[message].status': status,
              updatedAt: stamp
            }
          },
          {
            arrayFilters: [{
              'message.id': { $in: messageIdCandidates }
            }]
          }
        );
        if (!result?.matchedCount) throw new Error('Message not found');
        return normalizeMessage({
          id: normalizedMessageId,
          status,
          timestamp: stamp
        });
      }
    }, 'core.chat.updateMessageStatus');
  },

  async getUnreadSummaryForUser(userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.getUnreadSummaryForUser(userId),
      mongo: async () => {
        const userKey = toPublicId(userId);
        const rows = await getMongoCollection('chatConversations')
          .find(
            { 'participants.userId': userKey },
            { projection: { id: 1, participants: 1 } }
          )
          .toArray();
        return buildUnreadSummary(
          rows.map(normalizeChatDocument).filter(Boolean),
          userKey
        );
      }
    }, 'core.chat.getUnreadSummaryForUser');
  },

  async getConversationsForUser(userId, query = {}) {
    return await this.list({
      query,
      scope: {
        canViewAll: false,
        userId
      }
    });
  }
};

assertQueryableCrudRepository('chatRepository', chatRepository);

module.exports = chatRepository;
