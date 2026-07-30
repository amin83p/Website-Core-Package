'use strict';

module.exports = Object.freeze({
  schoolOverallReportTemplates: [
    { key: { id: 1 }, options: { name: 'idx_school_overall_report_templates_id', unique: true } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_overall_report_templates_org_status_updated' } },
    { key: { orgId: 1, 'sourceSlots.templateId': 1 }, options: { name: 'idx_school_overall_report_templates_org_source_template' } }
  ],
  schoolOverallReportInstances: [
    { key: { id: 1 }, options: { name: 'idx_school_overall_report_instances_id', unique: true } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_overall_report_instances_org_status_updated' } },
    { key: { orgId: 1, overallTemplateId: 1 }, options: { name: 'idx_school_overall_report_instances_org_template' } },
    { key: { orgId: 1, 'sourceSelections.instanceId': 1 }, options: { name: 'idx_school_overall_report_instances_org_source_instance' } }
  ]
});
