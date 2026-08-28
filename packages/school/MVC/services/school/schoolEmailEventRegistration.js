'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { registerPackageEmailEvents } = requireCoreModule('MVC/services/emailEventRegistry');

function registerSchoolEmailEvents() {
  registerPackageEmailEvents('SCHOOL', [{
    eventKey: 'SCHOOL_UNCOMPLETED_SESSION_EMAIL',
    label: 'Uncompleted session email',
    packageName: 'SCHOOL',
    sectionId: 'SCHOOL_SESSION_ACCESS',
    operationId: 'NOTIFY',
    allowedPlaceholders: [
      'TEACHER_NAME',
      'ORG_NAME',
      'SESSION_COUNT',
      'SESSION_LIST',
      'BODY_CONTENT',
      'CLASS_NAME',
      'CLASS_ID',
      'SESSION_NAME',
      'SESSION_ID',
      'SESSION_DATE',
      'SESSION_TIME',
      'SESSION_MANAGER_URL'
    ],
    runtimePlaceholders: [
      'SESSION_LIST',
      'SESSION_COUNT',
      'BODY_CONTENT',
      'CLASS_NAME',
      'CLASS_ID',
      'SESSION_NAME',
      'SESSION_ID',
      'SESSION_DATE',
      'SESSION_TIME',
      'SESSION_MANAGER_URL'
    ],
    requiredPlaceholders: ['TEACHER_NAME'],
    isActive: true
  }]);
}

module.exports = {
  registerSchoolEmailEvents
};
