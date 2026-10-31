#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const ROOT_DIR = path.join(__dirname, '../../..');

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !Object.prototype.hasOwnProperty.call(process.env, m[1].trim())) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}

async function main() {
  loadEnv();
  const { resolveDataBackendConfig } = require('../../../config/dataBackend');
  const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
  const { connectMongo, disconnectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
  setActiveDataBackendConfig(resolveDataBackendConfig());
  await connectMongo();

  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const reportViewService = require('../MVC/services/school/reportViewService');
  const reqUser = { id: 'verify', activeOrgId: '900000', scope: { canViewAll: true }, isSuperAdmin: true };

  const instance = await schoolDataService.getDataById('reportInstances', '173493', reqUser);
  const assignment = await schoolDataService.getDataById('reportAssignments', instance?.assignmentId, reqUser);
  const template = await schoolDataService.getDataById('reportTemplates', instance?.templateId, reqUser);
  const siblings = await reportViewService.loadAssignmentInstancesForSharedGate(instance.assignmentId, reqUser);
  const gate = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances: siblings,
    currentInstanceId: instance.id
  });

  console.log(JSON.stringify({
    instanceId: instance?.id,
    assignmentId: instance?.assignmentId,
    assignmentStatus: assignment?.status,
    instanceStatus: instance?.status,
    siblingCount: siblings.length,
    siblingStatuses: [...new Set(siblings.map((row) => row.status))],
    sharedFieldsEditable: gate.sharedFieldsEditable,
    blockingSiblingCount: gate.blockingSiblingCount,
    reason: gate.reason
  }, null, 2));

  await disconnectMongo();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
