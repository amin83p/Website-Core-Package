const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function findByName(rows, name) {
  return rows.find((row) => String(row?.name || '') === name);
}

test('USER_SETTINGS is declared as a core access section and symbol', () => {
  const { SECTIONS } = require('../config/accessConstants');
  assert.equal(SECTIONS.USER_SETTINGS, 'USER_SETTINGS');

  for (const file of ['data/sections.json', 'data/bootstrap/core/sections.json']) {
    const rows = readJson(file);
    const section = findByName(rows, 'USER_SETTINGS');
    const parent = findByName(rows, 'SYSTEM_SETTING');

    assert.ok(section, `${file} should include USER_SETTINGS`);
    assert.equal(section.id, '862453');
    assert.equal(section.category, 'SYSTEM');
    assert.equal(section.homeURL, '/userSettings/');
    assert.equal(section.navigatorSection, false);
    assert.equal(section.trackState, true);
    assert.deepEqual((section.operations || []).map((op) => op.id), ['OP1002', 'OP1003', 'OP1005', 'OP1004', 'OP1012']);
    assert.ok((parent.subsections || []).some((row) => String(row.id) === '862453'));
  }

  for (const file of ['data/symbols.json', 'data/bootstrap/core/symbols.json']) {
    const rows = readJson(file);
    const symbol = findByName(rows, 'USER_SETTINGS');
    assert.ok(symbol, `${file} should include USER_SETTINGS symbol`);
    assert.equal(symbol.id, 'SYM_SYSTEM_091');
    assert.equal(symbol.value, 'bi bi-person-gear');
  }
});

test('user settings service returns empty settings when no row exists and upserts nested values', async () => {
  const { createService } = require('../MVC/services/userSettingsService');
  const store = new Map();
  const service = createService({
    repository: {
      async getUserSettings(userId) {
        return store.get(userId) || null;
      },
      async updateSetting(data) {
        const record = {
          id: data.userId,
          userId: data.userId,
          settings: data.settings,
          audit: { lastUpdateUser: data.auditUser }
        };
        store.set(data.userId, record);
        return record;
      }
    }
  });

  assert.deepEqual(await service.getSettings('USER_1'), {});
  await service.setSetting('USER_1', 'pageDiagnostics.enabled', false, { id: 'ADMIN_1' });
  assert.deepEqual(await service.getSettings('USER_1'), {
    pageDiagnostics: { enabled: false }
  });
  assert.equal(await service.getSetting('USER_1', 'pageDiagnostics.enabled', true), false);
});

test('user settings repository and data gateway are registered for JSON and Mongo', () => {
  const gateway = read('MVC/services/data/entityGatewayService.js');
  const scope = read('MVC/services/security/dataScopeBuilder.js');
  const accessScope = read('MVC/services/data/accessScopeService.js');
  const queryBootstrap = read('MVC/models/queryExecutorBootstrap.js');
  const indexManager = read('MVC/infrastructure/mongo/mongoIndexManager.js');
  const ensureIndexes = read('scripts/core/ensure-core-list-indexes.js');

  assert.match(gateway, /userSettingsRepository/);
  assert.match(gateway, /userSettings:\s*{\s*repository:\s*userSettingsRepository/);
  assert.match(gateway, /case 'userSettings'/);
  assert.match(scope, /buildUserSettingsScope/);
  assert.match(accessScope, /getAccessibleUserSettings/);
  assert.match(queryBootstrap, /usersettings/);
  assert.match(indexManager, /idx_user_settings_id[\s\S]*unique:\s*true/);
  assert.match(indexManager, /idx_user_settings_userId[\s\S]*unique:\s*true/);
  assert.match(indexManager, /idx_user_settings_last_update_dt/);
  assert.match(ensureIndexes, /'userSettings'/);
});

test('user settings routes require USER_SETTINGS operations', () => {
  const routeSource = read('MVC/routes/userSettingsRoutes.js');
  assert.match(routeSource, /USER_SETTINGS_SEC/);
  assert.match(routeSource, /requireAccess\(USER_SETTINGS_SEC,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(USER_SETTINGS_SEC,\s*OPERATIONS\.READ\)/);
  assert.match(routeSource, /requireAccess\(USER_SETTINGS_SEC,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(USER_SETTINGS_SEC,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /requireAccess\(USER_SETTINGS_SEC,\s*OPERATIONS\.EXPORT\)/);
  assert.match(routeSource, /router\.get\('\/picker\/users'[\s\S]*requireAccess\(USER_SETTINGS_SEC,\s*OPERATIONS\.READ_ALL\)[\s\S]*ctrl\.pickerUsers/);
  assert.ok(
    routeSource.indexOf("router.get('/picker/users'") < routeSource.indexOf("router.get('/:userId'"),
    'picker route must be declared before the dynamic userId route'
  );
});

test('user settings form uses full-width layout and generic user picker in view and edit modes', () => {
  const form = read('MVC/views/userSettings/form.ejs');
  const css = read('public/styles/main.css');

  assert.match(form, /form-container user-settings-form-container/);
  assert.doesNotMatch(form, /max-width:\s*1000px/);
  assert.match(css, /\.user-settings-form-container\s*{[\s\S]*max-width:\s*100%/);
  assert.match(form, /include\('\.\.\/partials\/modal_GenericPicker'/);
  assert.match(form, /id="pickUserSettingsUserBtn"/);
  assert.match(form, /GenericPickerPresets\.user/);
  assert.match(form, /apiEndpoint:\s*'\/userSettings\/picker\/users'/);
  assert.match(form, /state\.mode === 'edit'/);
  assert.match(form, /\/userSettings\/edit\/\$\{encoded\}/);
  assert.match(form, /\/userSettings\/\$\{encoded\}/);
});

test('user settings controller renders missing rows as empty settings and sanitizes picker users', () => {
  const controllerSource = read('MVC/controllers/userSettingsController.js');
  const controller = require('../MVC/controllers/userSettingsController');

  assert.match(controllerSource, /buildViewRecord\(record,\s*userId\)/);
  assert.match(controllerSource, /hasSavedSettings:\s*Boolean\(record\)/);
  assert.match(controllerSource, /exists:\s*Boolean\(record\)/);
  assert.doesNotMatch(controllerSource, /User settings not found/);
  assert.doesNotMatch(controllerSource, /render\('404'/);
  assert.match(controllerSource, /fetchDataPaged\('users'[\s\S]*projection:\s*USER_PICKER_PROJECTION/);

  const sanitized = controller.sanitizeUserPickerRow({
    id: 'U1',
    username: 'admin',
    email: 'admin@example.test',
    displayName: 'Admin User',
    status: 'active',
    active: true,
    primaryOrgId: '900000',
    passwordHash: 'secret',
    preferences: { pageDiagnostics: { enabled: false } },
    systemAccessProfileId: 'AP1'
  });

  assert.deepEqual(Object.keys(sanitized).sort(), [
    'active',
    'displayName',
    'email',
    'id',
    'name',
    'primaryOrgId',
    'status',
    'userId',
    'username'
  ].sort());
  assert.equal(sanitized.id, 'U1');
  assert.equal(sanitized.displayName, 'Admin User');
  assert.equal(sanitized.name, 'Admin User');
  assert.equal(sanitized.passwordHash, undefined);
  assert.equal(sanitized.preferences, undefined);
  assert.equal(sanitized.systemAccessProfileId, undefined);
});

test('page diagnostics preference writes userSettings instead of users preferences', () => {
  const controllerSource = read('MVC/controllers/pageDiagnosticsController.js');
  const authSource = read('MVC/services/authService.js');
  const appSource = read('app.js');

  assert.match(controllerSource, /userSettingsService\.setSetting/);
  assert.doesNotMatch(controllerSource, /getDataById\('users'/);
  assert.doesNotMatch(controllerSource, /updateData\('users'/);
  assert.match(authSource, /loadSafeUserSettings/);
  assert.match(authSource, /userSettings:/);
  assert.match(appSource, /req\.user\.pageDiagnosticsEnabled !== false/);
});

test('user settings seed and migration scripts are guarded and idempotent', () => {
  const seedSource = read('scripts/seed-user-settings-section.js');
  const migration = require('../scripts/migrate-page-diagnostics-user-settings');
  const pkg = readJson('package.json');

  assert.match(seedSource, /SECTION_ID = '862453'/);
  assert.match(seedSource, /SECTION_NAME = 'USER_SETTINGS'/);
  assert.match(seedSource, /SYMBOL_ID = 'SYM_SYSTEM_091'/);
  assert.match(seedSource, /SYSTEM_SETTING/);
  assert.match(seedSource, /idx_user_settings_id/);
  assert.match(seedSource, /Default mode is dry-run/);

  const planned = migration.planJsonMigration([
    { id: 'U1', preferences: { pageDiagnostics: { enabled: false } } },
    { id: 'U2', preferences: { pageDiagnostics: { enabled: true } } }
  ], [
    { id: 'U2', userId: 'U2', settings: { pageDiagnostics: { enabled: false } } }
  ]);

  assert.equal(planned.report.inserted, 1);
  assert.equal(planned.report.skippedExisting, 1);
  assert.equal(planned.rows.find((row) => row.userId === 'U1').settings.pageDiagnostics.enabled, false);
  assert.equal(planned.rows.find((row) => row.userId === 'U2').settings.pageDiagnostics.enabled, false);

  assert.equal(pkg.scripts['core:user-settings:seed'], 'node scripts/seed-user-settings-section.js');
  assert.equal(pkg.scripts['core:user-settings:seed:apply'], 'node scripts/seed-user-settings-section.js --apply');
  assert.equal(pkg.scripts['core:user-settings:migrate-page-diagnostics'], 'node scripts/migrate-page-diagnostics-user-settings.js');
  assert.equal(pkg.scripts['core:user-settings:migrate-page-diagnostics:apply'], 'node scripts/migrate-page-diagnostics-user-settings.js --apply');
});
