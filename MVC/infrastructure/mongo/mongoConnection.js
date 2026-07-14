const { getActiveDataBackendConfig } = require('../runtime/dataBackendRuntime');
const { ensureMongoIndexes } = require('./mongoIndexManager');
const startupLogger = require('../../utils/startupLogger');

let mongoDriver = null;
let mongoClient = null;
let mongoDb = null;
let connectPromise = null;
let indexInitPromise = null;

function loadMongoDriver() {
  if (mongoDriver) return mongoDriver;
  try {
    // Lazy-load so JSON mode does not require mongodb package at runtime.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    mongoDriver = require('mongodb');
    return mongoDriver;
  } catch (error) {
    const help = 'Install package "mongodb" and ensure dependencies are up to date.';
    throw new Error(`MongoDB driver is not available. ${help} Original: ${error.message}`);
  }
}

function inferDbNameFromUri(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function resolveMongoConnectionConfig(options = {}) {
  const runtime = getActiveDataBackendConfig();
  const runtimeUri = String(runtime?.mongo?.uri || '').trim();
  const uri = String(options?.uri || runtimeUri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  const dbNameFromUri = inferDbNameFromUri(uri);
  const dbName = String(options?.dbName || process.env.MONGODB_DB || process.env.MONGO_DB || dbNameFromUri || 'app').trim();

  return { uri, dbName };
}

async function connectMongo(options = {}) {
  if (mongoDb) return mongoDb;
  if (connectPromise) return connectPromise;

  const { uri, dbName } = resolveMongoConnectionConfig(options);
  if (!uri) {
    throw new Error('Mongo connection URI is missing. Set MONGODB_URI in environment variables. Legacy MONGO_URI is still supported temporarily.');
  }

  const { MongoClient } = loadMongoDriver();

  connectPromise = (async () => {
    const client = new MongoClient(uri, {
      maxPoolSize: Number(options?.maxPoolSize || process.env.MONGO_MAX_POOL || 20),
      minPoolSize: Number(options?.minPoolSize || process.env.MONGO_MIN_POOL || 0),
      serverSelectionTimeoutMS: Number(options?.serverSelectionTimeoutMS || process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000)
    });

    await client.connect();
    const db = client.db(dbName);
    mongoClient = client;
    mongoDb = db;

    if (!indexInitPromise) {
      indexInitPromise = ensureMongoIndexes(db, options).catch((error) => {
        startupLogger.warn('MONGOINDEX', 'INITIALIZATION', 'Index initialization warning.', { error: error.message });
      });
    }
    await indexInitPromise;

    return mongoDb;
  })();

  try {
    return await connectPromise;
  } catch (error) {
    connectPromise = null;
    mongoClient = null;
    mongoDb = null;
    throw error;
  }
}

function getMongoDbOrNull() {
  return mongoDb;
}

function getMongoCollection(name) {
  const collectionName = String(name || '').trim();
  if (!collectionName) throw new Error('Mongo collection name is required.');
  if (!mongoDb) {
    throw new Error('MongoDB is not connected yet. Call connectMongo() first.');
  }
  return mongoDb.collection(collectionName);
}

async function withMongoTransaction(operation, options = {}) {
  if (typeof operation !== 'function') throw new Error('Mongo transaction operation must be a function.');
  if (!mongoClient) throw new Error('MongoDB is not connected yet. Call connectMongo() first.');
  const session = mongoClient.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    }, options.transactionOptions || {});
    return result;
  } finally {
    await session.endSession();
  }
}

async function getMongoTransactionCapability() {
  if (!mongoDb) throw new Error('MongoDB is not connected yet. Call connectMongo() first.');
  const hello = await mongoDb.admin().command({ hello: 1 });
  const isMongos = String(hello?.msg || '').toLowerCase() === 'isdbgrid';
  const isReplicaSet = Boolean(String(hello?.setName || '').trim());
  return {
    supported: isMongos || isReplicaSet,
    topology: isMongos ? 'mongos' : (isReplicaSet ? 'replicaSet' : 'standalone'),
    setName: String(hello?.setName || '').trim()
  };
}

async function pingMongo() {
  if (!mongoDb) return false;
  await mongoDb.command({ ping: 1 });
  return true;
}

async function disconnectMongo() {
  connectPromise = null;
  indexInitPromise = null;
  const client = mongoClient;
  mongoClient = null;
  mongoDb = null;
  if (client) {
    await client.close();
  }
}

module.exports = {
  connectMongo,
  disconnectMongo,
  pingMongo,
  getMongoDbOrNull,
  getMongoCollection,
  getMongoTransactionCapability,
  withMongoTransaction,
  resolveMongoConnectionConfig
};
