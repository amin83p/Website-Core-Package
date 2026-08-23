'use strict';

const expressSession = require('express-session');
const { getMongoCollection } = require('./mongoConnection');

const DEFAULT_COLLECTION_NAME = 'expressSessions';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveExpiry(sessionData = {}, ttlMs = DEFAULT_TTL_MS) {
  const cookieExpires = toDate(sessionData?.cookie?.expires);
  if (cookieExpires) return cookieExpires;
  return new Date(Date.now() + ttlMs);
}

class MongoSessionStore extends expressSession.Store {
  constructor(options = {}) {
    super();
    this.collectionName = String(options.collectionName || DEFAULT_COLLECTION_NAME).trim() || DEFAULT_COLLECTION_NAME;
    this.ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
    this.indexPromise = null;
  }

  collection() {
    return getMongoCollection(this.collectionName);
  }

  ensureIndexes() {
    if (!this.indexPromise) {
      const collection = this.collection();
      this.indexPromise = Promise.all([
        collection.createIndex({ sid: 1 }, { name: 'idx_express_sessions_sid', unique: true }),
        collection.createIndex({ expiresAt: 1 }, { name: 'idx_express_sessions_expiresAt_ttl', expireAfterSeconds: 0 })
      ]);
    }
    return this.indexPromise;
  }

  get(sid, callback) {
    this.ensureIndexes()
      .then(() => this.collection().findOne({ sid: String(sid || '') }))
      .then(async (row) => {
        if (!row) return callback(null, null);
        const expiresAt = toDate(row.expiresAt);
        if (expiresAt && expiresAt.getTime() <= Date.now()) {
          await this.collection().deleteOne({ sid: String(sid || '') }).catch(() => {});
          return callback(null, null);
        }
        return callback(null, row.session || null);
      })
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback = () => {}) {
    const sessionId = String(sid || '');
    this.ensureIndexes()
      .then(() => this.collection().updateOne(
        { sid: sessionId },
        {
          $set: {
            sid: sessionId,
            session: sessionData,
            expiresAt: resolveExpiry(sessionData, this.ttlMs),
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        { upsert: true }
      ))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  destroy(sid, callback = () => {}) {
    this.ensureIndexes()
      .then(() => this.collection().deleteOne({ sid: String(sid || '') }))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  touch(sid, sessionData, callback = () => {}) {
    this.ensureIndexes()
      .then(() => this.collection().updateOne(
        { sid: String(sid || '') },
        {
          $set: {
            session: sessionData,
            expiresAt: resolveExpiry(sessionData, this.ttlMs),
            updatedAt: new Date()
          }
        }
      ))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }
}

module.exports = {
  MongoSessionStore,
  DEFAULT_COLLECTION_NAME,
  DEFAULT_TTL_MS
};
