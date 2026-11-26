'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const accessRoutes = fs.readFileSync(path.join(__dirname, '..', 'MVC', 'routes', 'accessRoutes.js'), 'utf8');
const accessConstants = fs.readFileSync(path.join(__dirname, '..', 'config', 'accessConstants.js'), 'utf8');

test('access routes enforce requireAccess on CRUD', () => {
  assert.match(accessRoutes, /requireAccess\(SECTIONS\.ACCESS_PROFILES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(accessRoutes, /requireAccess\(SECTIONS\.ACCESS_PROFILES,\s*OPERATIONS\.CREATE\)/);
  assert.match(accessRoutes, /requireAccess\(SECTIONS\.ACCESS_PROFILES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(accessRoutes, /requireAccess\(SECTIONS\.ACCESS_PROFILES,\s*OPERATIONS\.DELETE\)/);
});

test('ACCESS_PROFILES section constant resolves to ACCESSES catalog name', () => {
  assert.match(accessConstants, /ACCESS_PROFILES:\s*'ACCESSES'/);
});

const contractRoutes = fs.readFileSync(path.join(__dirname, '..', 'MVC', 'routes', 'contractRoutes.js'), 'utf8');
const newsRoutes = fs.readFileSync(path.join(__dirname, '..', 'MVC', 'routes', 'newsRoutes.js'), 'utf8');
const websitePolicyRoutes = fs.readFileSync(path.join(__dirname, '..', 'MVC', 'routes', 'websitePolicyRoutes.js'), 'utf8');
const operationController = fs.readFileSync(path.join(__dirname, '..', 'MVC', 'controllers', 'operationController.js'), 'utf8');

test('contract routes enforce requireAccess on CRUD', () => {
  assert.match(contractRoutes, /requireAccess\(SECTIONS\.CONTRACTS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(contractRoutes, /requireAccess\(SECTIONS\.CONTRACTS,\s*OPERATIONS\.CREATE\)/);
  assert.match(contractRoutes, /requireAccess\(SECTIONS\.CONTRACTS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(contractRoutes, /requireAccess\(SECTIONS\.CONTRACTS,\s*OPERATIONS\.DELETE\)/);
});

test('news admin routes use requireAccess for manage mutations', () => {
  assert.match(newsRoutes, /requireAccess\(SECTIONS\.NEWS,/);
  assert.match(newsRoutes, /trackActionState\(SECTIONS\.NEWS,/);
});

test('website policy routes enforce requireAccess', () => {
  assert.match(websitePolicyRoutes, /requireAccess\(SECTIONS\.WEBSITE_POLICY,\s*OPERATIONS\.READ\)/);
  assert.match(websitePolicyRoutes, /requireAccess\(SECTIONS\.WEBSITE_POLICY,\s*OPERATIONS\.UPDATE\)/);
});

test('operation delete passes requesting user into deleteData', () => {
  assert.match(operationController, /deleteData\([^)]*req\.user/);
});