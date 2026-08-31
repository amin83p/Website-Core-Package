'use strict';

const accessUiService = require('./security/accessUiService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const NAV_ACTIONS = Object.freeze([
  {
    key: 'manager',
    label: 'Task Manager',
    href: '/scheduled-tasks/manager',
    icon: 'bi-calendar2-check',
    sectionId: SECTIONS.SCHEDULED_TASK_MANAGER,
    operationId: OPERATIONS.READ_ALL
  },
  {
    key: 'definitions',
    label: 'Definitions',
    href: '/scheduled-tasks',
    icon: 'bi-list-task',
    sectionId: SECTIONS.AUTO_SCHEDULED_TASKS,
    operationId: OPERATIONS.READ_ALL
  },
  {
    key: 'runs',
    label: 'Runs',
    href: '/scheduled-tasks/runs',
    icon: 'bi-clock-history',
    sectionId: SECTIONS.AUTO_SCHEDULED_TASK_RUNS,
    operationId: OPERATIONS.READ_ALL
  },
  {
    key: 'outbox',
    label: 'Email Outbox',
    href: '/scheduled-tasks/outbox',
    icon: 'bi-envelope-paper',
    sectionId: SECTIONS.EMAIL_OUTBOX,
    operationId: OPERATIONS.READ_ALL
  }
]);

async function buildDefinitionAccessFlags(req) {
  return accessUiService.accessFlags(req, SECTIONS.AUTO_SCHEDULED_TASKS, {
    canRead: OPERATIONS.READ_ALL,
    canRun: OPERATIONS.START,
    canUpdate: OPERATIONS.UPDATE,
    canDelete: OPERATIONS.DELETE
  });
}

async function buildOutboxAccessFlags(req) {
  return accessUiService.accessFlags(req, SECTIONS.EMAIL_OUTBOX, {
    canRead: OPERATIONS.READ_ALL,
    canCancel: OPERATIONS.UPDATE,
    canDelete: OPERATIONS.DELETE
  });
}

async function buildRunAccessFlags(req) {
  return accessUiService.accessFlags(req, SECTIONS.AUTO_SCHEDULED_TASK_RUNS, {
    canRead: OPERATIONS.READ_ALL,
    canCancel: OPERATIONS.UPDATE
  });
}

async function buildNavButtons(req, activeKey = '') {
  const actions = await accessUiService.filterActions(req, NAV_ACTIONS);
  return accessUiService.renderActions(
    actions
      .filter((action) => action.key !== String(activeKey || '').trim())
      .map((action) => ({
        ...action,
        className: 'btn btn-outline-primary btn-md mb-2'
      }))
  );
}

async function buildManagerAccessFlags(req) {
  return accessUiService.accessFlags(req, SECTIONS.SCHEDULED_TASK_MANAGER, {
    canRead: OPERATIONS.READ_ALL
  });
}

module.exports = {
  buildDefinitionAccessFlags,
  buildOutboxAccessFlags,
  buildRunAccessFlags,
  buildManagerAccessFlags,
  buildNavButtons
};
