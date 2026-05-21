/* eslint-disable no-console */
const { resolveDataBackendConfig } = require('../config/dataBackend');
const { setActiveDataBackendConfig } = require('../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo } = require('../MVC/infrastructure/mongo/mongoConnection');

const userRepository = require('../MVC/repositories/userRepository');
const personRepository = require('../MVC/repositories/personRepository');
const organizationRepository = require('../MVC/repositories/organizationRepository');
const accessRepository = require('../MVC/repositories/accessRepository');
const accessPolicyRepository = require('../MVC/repositories/accessPolicyRepository');
const sectionRepository = require('../MVC/repositories/sectionRepository');
const operationRepository = require('../MVC/repositories/operationRepository');
const scopeRepository = require('../MVC/repositories/scopeRepository');
const symbolRepository = require('../MVC/repositories/symbolRepository');
const sessionRepository = require('../MVC/repositories/sessionRepository');
const contactRepository = require('../MVC/repositories/contactRepository');
const helpArticleRepository = require('../MVC/repositories/helpArticleRepository');
const newsRepository = require('../MVC/repositories/newsRepository');
const newsletterRepository = require('../MVC/repositories/newsletterRepository');
const subscriptionGroupRepository = require('../MVC/repositories/subscriptionGroupRepository');
const chatRepository = require('../MVC/repositories/chatRepository');
const taskRepository = require('../MVC/repositories/taskRepository');
const tableSettingsRepository = require('../MVC/repositories/tableSettingsRepository');
const contractRepository = require('../MVC/repositories/contractRepository');
const orgPolicyRepository = require('../MVC/repositories/orgPolicyRepository');
const logRepository = require('../MVC/repositories/logRepository');
const actionStateRepository = require('../MVC/repositories/actionStateRepository');
const websitePolicyRepository = require('../MVC/repositories/websitePolicyRepository');

const now = Date.now();
const suffix = `${now}-${Math.floor(Math.random() * 1000)}`;

function printResult(ok, label, details = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${details ? ` :: ${details}` : ''}`);
}

function maskMongoUri(uri = '') {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString().replace(/%2A/g, '*');
  } catch (_) {
    return '[configured]';
  }
}

async function runStep(label, fn) {
  try {
    const value = await fn();
    printResult(true, label);
    return { ok: true, value };
  } catch (error) {
    printResult(false, label, error.message);
    return { ok: false, error };
  }
}

async function main() {
  const backend = resolveDataBackendConfig(process.env, { preferredMode: 'mongo' });
  setActiveDataBackendConfig(backend);
  const mongoConfig = backend.mongo || {};
  const mongoUri = String(mongoConfig.uri || '').trim();

  if (backend.mode !== 'mongo' || !mongoUri) {
    throw new Error('Mongo smoke requires DATA_BACKEND=mongo and MONGODB_URI (legacy MONGO_URI supported).');
  }

  await connectMongo({ uri: mongoUri });
  console.log(`[INFO] Connected to Mongo backend (${maskMongoUri(mongoUri)}).`);

  const ids = {};
  const sharedOrgId = `ORG-${suffix}`;
  const sharedUserId = `USR-${suffix}`;
  const sharedPersonId = `PRS-${suffix}`;
  const baseOptions = { backendMode: 'mongo' };

  await runStep('organizations.create', async () => {
    const created = await organizationRepository.create({
      id: sharedOrgId,
      identity: { legalName: `Smoke Org ${suffix}`, displayName: `Smoke Org ${suffix}` },
      active: true,
      audit: {
        createUser: 'smoke',
        createDateTime: new Date().toISOString(),
        lastUpdateUser: 'smoke',
        lastUpdateDateTime: new Date().toISOString()
      }
    }, baseOptions);
    ids.orgId = created.id;
  });

  await runStep('persons.create', async () => {
    const created = await personRepository.create({
      id: sharedPersonId,
      name: { first: 'Smoke', last: `Person-${suffix}` },
      demographics: { dateOfBirth: '1990-01-01', gender: 'other' },
      contact: { emails: [{ email: `person.${suffix}@example.com`, isPrimary: true }] },
      organizations: [{ orgId: ids.orgId || sharedOrgId, roles: ['member'] }]
    }, baseOptions);
    ids.personId = created.id;
  });

  await runStep('users.create', async () => {
    const created = await userRepository.create({
      id: sharedUserId,
      email: `user.${suffix}@example.com`,
      username: `smoke_user_${suffix}`,
      passwordHash: 'smoke',
      active: true,
      status: 'active',
      accessLevel: 1,
      personId: ids.personId || sharedPersonId,
      organizations: [{ orgId: ids.orgId || sharedOrgId, roles: ['member'] }]
    }, baseOptions);
    ids.userId = created.id;
  });

  await runStep('sections/operations/scopes/symbols/session CRUD', async () => {
    const section = await sectionRepository.create({ name: `Smoke Section ${suffix}`, category: 'School' }, baseOptions);
    ids.sectionId = section.id;
    const op = await operationRepository.create({ name: `Smoke Op ${suffix}`, sectionId: section.id }, baseOptions);
    ids.operationId = op.id;
    const scope = await scopeRepository.create({ name: `Smoke Scope ${suffix}` }, baseOptions);
    ids.scopeId = scope.id;
    const symbol = await symbolRepository.create({ name: `Smoke Symbol ${suffix}`, orgId: ids.orgId || sharedOrgId }, baseOptions);
    ids.symbolId = symbol.id;
    const session = await sessionRepository.create({ userId: ids.userId || sharedUserId, status: 'active' }, baseOptions);
    ids.sessionId = session.id;
  });

  await runStep('access/accessPolicy CRUD', async () => {
    const access = await accessRepository.create({
      userId: ids.userId || sharedUserId,
      orgId: ids.orgId || sharedOrgId,
      sectionId: ids.sectionId,
      operationId: ids.operationId
    }, baseOptions);
    ids.accessId = access.id;
    const policy = await accessPolicyRepository.create({
      userId: ids.userId || sharedUserId,
      profileName: `Smoke Profile ${suffix}`
    }, baseOptions);
    ids.accessPolicyId = policy.id;
  });

  await runStep('contacts/help/news/newsletter/subscriptionGroup CRUD', async () => {
    const contact = await contactRepository.create({
      name: `Smoke Contact ${suffix}`,
      email: `contact.${suffix}@example.com`,
      message: 'smoke',
      status: 'new'
    }, baseOptions);
    ids.contactId = contact.id;
    const help = await helpArticleRepository.create({
      title: `Smoke Help ${suffix}`,
      slug: `smoke-help-${suffix}`,
      active: true
    }, baseOptions);
    ids.helpId = help.id;
    const news = await newsRepository.create({
      title: `Smoke News ${suffix}`,
      slug: `smoke-news-${suffix}`,
      status: 'published',
      visibility: 'public'
    }, baseOptions);
    ids.newsId = news.id;
    const sub = await newsletterRepository.create({
      email: `newsletter.${suffix}@example.com`,
      status: 'subscribed'
    }, baseOptions);
    ids.newsletterId = sub.id;
    const group = await subscriptionGroupRepository.create({
      name: `Smoke Group ${suffix}`,
      orgId: ids.orgId || sharedOrgId
    }, baseOptions);
    ids.groupId = group.id;
  });

  await runStep('chat/task/tableSettings CRUD', async () => {
    const chat = await chatRepository.create({
      userIds: [ids.userId || sharedUserId, `OTHER-${suffix}`]
    }, baseOptions);
    ids.chatId = chat.id;
    await chatRepository.addMessage(chat.id, ids.userId || sharedUserId, 'smoke message', 'text', null, baseOptions);

    const task = await taskRepository.create({
      title: `Smoke Task ${suffix}`,
      status: 'open',
      assignees: [{ userId: ids.userId || sharedUserId }]
    }, { ...baseOptions, userId: ids.userId || sharedUserId });
    ids.taskId = task.id;
    await taskRepository.addComment(task.id, { text: 'smoke comment', userId: ids.userId || sharedUserId }, baseOptions);

    await tableSettingsRepository.create({
      userId: ids.userId || sharedUserId,
      tableId: `smoke-table-${suffix}`,
      columns: []
    }, baseOptions);
  });

  await runStep('contracts/orgPolicy/log/actionState/websitePolicy', async () => {
    const contract = await contractRepository.create({
      orgId: ids.orgId || sharedOrgId,
      status: 'active',
      startDate: new Date().toISOString()
    }, baseOptions);
    ids.contractId = contract.id;

    const policy = await orgPolicyRepository.create({
      orgId: ids.orgId || sharedOrgId,
      policyName: `Smoke Org Policy ${suffix}`
    }, baseOptions);
    ids.orgPolicyId = policy.id;

    const log = await logRepository.create({
      sectionId: ids.sectionId || 'SEC',
      operationId: ids.operationId || 'OP',
      user: ids.userId || sharedUserId,
      status: 'ok',
      details: { smoke: true }
    }, baseOptions);
    ids.logId = log.id;

    const state = await actionStateRepository.create({
      userId: ids.userId || sharedUserId,
      sectionId: ids.sectionId || 'SEC',
      operationId: ids.operationId || 'OP',
      targetKey: 'smoke',
      limits: {}
    }, baseOptions);
    ids.actionStateId = state.id;
    await actionStateRepository.update(state.id, { action: 'complete', payload: { smoke: true } }, baseOptions);

    await websitePolicyRepository.getPolicy(baseOptions);
    await websitePolicyRepository.updatePolicy({ smokeCheck: { lastRun: new Date().toISOString() } }, 'smoke', baseOptions);
  });

  await runStep('core list/get/update parity spot-check', async () => {
    await userRepository.getById(ids.userId, baseOptions);
    await userRepository.getByUsername(`smoke_user_${suffix}`, baseOptions);
    await personRepository.getById(ids.personId, { ...baseOptions, enrichment: { includeSchoolRoles: false } });
    await organizationRepository.getById(ids.orgId, baseOptions);
    await userRepository.update(ids.userId, { status: 'active', smoke: true }, baseOptions);
    await personRepository.update(ids.personId, { smoke: true }, baseOptions);
    await organizationRepository.update(ids.orgId, { smoke: true }, baseOptions);
    await userRepository.list({ ...baseOptions, query: { q: 'smoke', limit: 5 } });
    await personRepository.list({ ...baseOptions, query: { q: 'smoke', limit: 5 }, enrichment: { includeSchoolRoles: false } });
    await organizationRepository.list({ ...baseOptions, query: { q: 'smoke', limit: 5 } });
  });

  console.log('[INFO] Mongo core smoke finished.');
}

main()
  .then(async () => {
    await disconnectMongo().catch(() => {});
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[SMOKE_ERROR] ${error.message}`);
    await disconnectMongo().catch(() => {});
    process.exit(1);
  });
