'use strict';

module.exports = Object.freeze({
  schoolStudents: [
    { key: { id: 1 }, options: { name: 'idx_school_students_id', unique: true } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_students_org_status_updated' } },
    { key: { orgId: 1, personId: 1 }, options: { name: 'idx_school_students_org_person', unique: true } },
    { key: { orgId: 1, 'audit.lastUpdateDateTime': -1, id: -1 }, options: { name: 'idx_school_students_org_updated_id' } }
  ],
  schoolTimesheets: [
    { key: { id: 1 }, options: { name: 'idx_school_timesheets_id', unique: true } },
    { key: { orgId: 1, periodId: 1, teacherId: 1 }, options: { name: 'idx_school_timesheets_org_period_teacher', unique: true } },
    { key: { orgId: 1, periodId: 1, status: 1 }, options: { name: 'idx_school_timesheets_org_period_status' } },
    { key: { orgId: 1, teacherId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_timesheets_org_teacher_status_updated' } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_timesheets_org_status_updated' } }
  ],
  schoolReportTemplates: [
    { key: { id: 1 }, options: { name: 'idx_school_report_templates_id', unique: true } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_report_templates_org_status_updated' } },
    { key: { orgId: 1, 'audit.lastUpdateDateTime': -1, id: -1 }, options: { name: 'idx_school_report_templates_org_updated_id' } }
  ],
  schoolReportAssignments: [
    { key: { id: 1 }, options: { name: 'idx_school_report_assignments_id', unique: true } },
    { key: { orgId: 1, classId: 1, sessionId: 1 }, options: { name: 'idx_school_report_assignments_org_class_session' } },
    { key: { orgId: 1, classId: 1, status: 1 }, options: { name: 'idx_school_report_assignments_org_class_status' } },
    { key: { orgId: 1, templateId: 1, status: 1 }, options: { name: 'idx_school_report_assignments_org_template_status' } },
    { key: { orgId: 1, 'teacherIds': 1 }, options: { name: 'idx_school_report_assignments_org_teacher_ids' } }
  ],
  schoolReportInstances: [
    { key: { id: 1 }, options: { name: 'idx_school_report_instances_id', unique: true } },
    { key: { orgId: 1, classId: 1, sessionId: 1, studentId: 1 }, options: { name: 'idx_school_report_instances_org_class_session_student' } },
    { key: { orgId: 1, assignmentId: 1, studentId: 1 }, options: { name: 'idx_school_report_instances_org_assignment_student' } },
    { key: { orgId: 1, studentId: 1, status: 1 }, options: { name: 'idx_school_report_instances_org_student_status' } },
    { key: { orgId: 1, teacherId: 1, status: 1 }, options: { name: 'idx_school_report_instances_org_teacher_status' } },
    {
      key: { orgId: 1, assignmentId: 1, teacherId: 1, targetKey: 1, assignmentRowId: 1 },
      options: { name: 'idx_school_report_instances_org_assignment_teacher_target' }
    },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_school_report_instances_org_status_updated' } }
  ],
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
