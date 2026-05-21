const chatModel = require('../models/chatModel');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
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
  return rows.map(normalizeMongoDocument).filter(Boolean);
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
      mongo: async () => normalizeMongoDocument(await getMongoCollection('chatConversations').findOne(resolveMongoIdFilter(id)))
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
        const payload = {
          ...(data || {}),
          participants: Array.isArray(data?.participants)
            ? data.participants
            : userIds.map((id) => ({ userId: id })),
          messages: Array.isArray(data?.messages) ? data.messages : []
        };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
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
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
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
        return Array.isArray(row?.messages) ? row.messages : [];
      }
    }, 'core.chat.getMessages');
  },

  async addMessage(convId, senderId, content, type = 'text', fileUrl = null, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.addMessage(convId, senderId, content, type, fileUrl),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const row = await collection.findOne(resolveMongoIdFilter(convId));
        if (!row) throw new Error('Conversation not found');
        const message = {
          id: await generateUniqueStringId(collection, null, { min: 1000000, max: 9999999 }),
          senderId: toPublicId(senderId),
          content: String(content || ''),
          type: String(type || 'text'),
          fileUrl: fileUrl || null,
          status: 'sent',
          sentAt: new Date().toISOString()
        };
        const messages = Array.isArray(row.messages) ? [...row.messages, message] : [message];
        await collection.updateOne(
          { _id: row._id },
          { $set: { messages, lastMessageAt: message.sentAt, updatedAt: message.sentAt } }
        );
        return message;
      }
    }, 'core.chat.addMessage');
  },

  async setLastRead(convId, userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.setLastRead(convId, userId),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const row = await collection.findOne(resolveMongoIdFilter(convId));
        if (!row) throw new Error('Conversation not found');
        const reads = Array.isArray(row.lastRead) ? [...row.lastRead] : [];
        const key = toPublicId(userId);
        const idx = reads.findIndex((item) => idsEqual(item?.userId, key));
        const stamp = new Date().toISOString();
        if (idx >= 0) reads[idx] = { ...reads[idx], userId: key, at: stamp };
        else reads.push({ userId: key, at: stamp });
        await collection.updateOne({ _id: row._id }, { $set: { lastRead: reads, updatedAt: stamp } });
        return true;
      }
    }, 'core.chat.setLastRead');
  },

  async updateMessageStatus(convId, messageId, newStatus, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => chatModel.updateMessageStatus(convId, messageId, newStatus),
      mongo: async () => {
        const collection = getMongoCollection('chatConversations');
        const row = await collection.findOne(resolveMongoIdFilter(convId));
        if (!row) throw new Error('Conversation not found');
        const messages = Array.isArray(row.messages) ? [...row.messages] : [];
        const idx = messages.findIndex((m) => idsEqual(m?.id, messageId));
        if (idx < 0) throw new Error('Message not found');
        messages[idx] = { ...messages[idx], status: String(newStatus || '').trim() || 'sent' };
        await collection.updateOne({ _id: row._id }, { $set: { messages, updatedAt: new Date().toISOString() } });
        return messages[idx];
      }
    }, 'core.chat.updateMessageStatus');
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
