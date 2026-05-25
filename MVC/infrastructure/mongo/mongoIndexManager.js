const startupLogger = require('../../utils/startupLogger');
const packageMongoIndexRegistry = require('./packageMongoIndexRegistry');

function isEnabled(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return defaultValue;
}

const INDEX_DEFINITIONS = Object.freeze({
  users: [
    { key: { id: 1 }, options: { name: 'idx_users_id' } },
    { key: { username: 1 }, options: { name: 'idx_users_username' } },
    { key: { email: 1 }, options: { name: 'idx_users_email' } },
    { key: { status: 1, active: 1 }, options: { name: 'idx_users_status_active' } },
    { key: { orgIds: 1 }, options: { name: 'idx_users_orgIds' } }
  ],
  sections: [
    { key: { id: 1 }, options: { name: 'idx_sections_id' } },
    { key: { name: 1 }, options: { name: 'idx_sections_name' } },
    { key: { category: 1 }, options: { name: 'idx_sections_category' } },
    { key: { dashboardDisplay: 1, mainDashboardDisplay: 1 }, options: { name: 'idx_sections_dashboard_flags' } },
    { key: { navigatorSection: 1 }, options: { name: 'idx_sections_navigatorSection' } }
  ],
  operations: [
    { key: { id: 1 }, options: { name: 'idx_operations_id' } },
    { key: { name: 1 }, options: { name: 'idx_operations_name' } }
  ],
  accesses: [
    { key: { id: 1 }, options: { name: 'idx_accesses_id' } },
    { key: { userId: 1, orgId: 1 }, options: { name: 'idx_accesses_user_org' } },
    { key: { status: 1 }, options: { name: 'idx_accesses_status' } }
  ],
  accessPolicies: [
    { key: { id: 1 }, options: { name: 'idx_accessPolicies_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_accessPolicies_org_status' } },
    { key: { userId: 1, orgId: 1, status: 1 }, options: { name: 'idx_accessPolicies_user_org_status' } },
    { key: { userId: 1, orgId: 1 }, options: { name: 'idx_accessPolicies_user_org_unique', unique: true } }
  ],
  symbols: [
    { key: { id: 1 }, options: { name: 'idx_symbols_id' } },
    { key: { name: 1 }, options: { name: 'idx_symbols_name' } },
    { key: { category: 1 }, options: { name: 'idx_symbols_category' } },
    { key: { tags: 1 }, options: { name: 'idx_symbols_tags' } }
  ],
  scopes: [
    { key: { id: 1 }, options: { name: 'idx_scopes_id' } },
    { key: { name: 1 }, options: { name: 'idx_scopes_name' } },
    { key: { active: 1 }, options: { name: 'idx_scopes_active' } }
  ],
  tableSettings: [
    { key: { id: 1 }, options: { name: 'idx_table_settings_id' } },
    { key: { userId: 1, tableId: 1 }, options: { name: 'idx_table_settings_user_table' } },
    { key: { userId: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_table_settings_user_last_update_dt' } },
    { key: { tableId: 1 }, options: { name: 'idx_table_settings_table_id' } },
    { key: { 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_table_settings_last_update_dt' } }
  ],
  contracts: [
    { key: { id: 1 }, options: { name: 'idx_contracts_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_contracts_org_status' } },
    { key: { orgId: 1, startDate: -1 }, options: { name: 'idx_contracts_org_start_date_desc' } },
    { key: { 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_contracts_last_update_dt' } }
  ],
  orgPolicies: [
    { key: { id: 1 }, options: { name: 'idx_org_policies_id' } },
    { key: { orgId: 1 }, options: { name: 'idx_org_policies_org_id' } },
    { key: { orgId: 1 }, options: { name: 'idx_org_policies_org_unique', unique: true } },
    { key: { active: 1 }, options: { name: 'idx_org_policies_active' } },
    { key: { 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_org_policies_last_update_dt' } }
  ],
  contacts: [
    { key: { id: 1 }, options: { name: 'idx_contacts_id' } },
    { key: { status: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_contacts_status_create_dt_desc' } },
    { key: { type: 1, status: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_contacts_type_status_create_dt_desc' } },
    { key: { email: 1 }, options: { name: 'idx_contacts_email' } }
  ],
  news: [
    { key: { id: 1 }, options: { name: 'idx_news_id' } },
    { key: { 'meta.slug': 1 }, options: { name: 'idx_news_meta_slug' } },
    { key: { status: 1, 'meta.publishDate': -1 }, options: { name: 'idx_news_status_publish_date_desc' } },
    { key: { visibility: 1, 'meta.publishDate': -1 }, options: { name: 'idx_news_visibility_publish_date_desc' } },
    { key: { 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_news_last_update_dt' } }
  ],
  newsletterSubscriptions: [
    { key: { id: 1 }, options: { name: 'idx_newsletter_subscriptions_id' } },
    { key: { email: 1 }, options: { name: 'idx_newsletter_subscriptions_email' } },
    { key: { subscribedAt: -1 }, options: { name: 'idx_newsletter_subscriptions_subscribed_desc' } },
    { key: { status: 1, subscribedAt: -1 }, options: { name: 'idx_newsletter_subscriptions_status_subscribed_desc' } },
    { key: { groupId: 1, subscribedAt: -1 }, options: { name: 'idx_newsletter_subscriptions_group_subscribed_desc' } },
    { key: { groupId: 1, status: 1, subscribedAt: -1 }, options: { name: 'idx_newsletter_subscriptions_group_status_subscribed_desc' } }
  ],
  subscriptionGroups: [
    { key: { id: 1 }, options: { name: 'idx_subscription_groups_id' } },
    { key: { name: 1 }, options: { name: 'idx_subscription_groups_name' } },
    { key: { 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_subscription_groups_last_update_dt' } }
  ],
  tasks: [
    { key: { id: 1 }, options: { name: 'idx_tasks_id' } },
    { key: { status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_tasks_status_last_update_dt' } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_tasks_org_status_last_update_dt' } },
    { key: { 'assignees.userId': 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_tasks_assignee_last_update_dt' } },
    { key: { 'assignees.userId': 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_tasks_assignee_status_last_update_dt' } }
  ],
  userMemberships: [
    { key: { id: 1 }, options: { name: 'idx_user_memberships_id' } },
    { key: { userId: 1, orgId: 1 }, options: { name: 'idx_user_memberships_user_org' } },
    { key: { userId: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_user_memberships_user_last_update_dt' } },
    { key: { orgId: 1, status: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_user_memberships_org_status_last_update_dt' } },
    { key: { status: 1, 'summary.effectiveEndDate': 1 }, options: { name: 'idx_user_memberships_status_effective_end_date' } }
  ],
  emailManagementTemplates: [
    { key: { id: 1 }, options: { name: 'idx_email_management_templates_id', unique: true } },
    { key: { orgId: 1, sectionId: 1, operationId: 1 }, options: { name: 'idx_email_management_templates_org_section_operation', unique: true } },
    { key: { orgId: 1, isActive: 1, updatedAt: -1 }, options: { name: 'idx_email_management_templates_org_active_updated' } },
    { key: { orgId: 1, updatedAt: -1 }, options: { name: 'idx_email_management_templates_org_updated' } }
  ],
  emailLedger: [
    { key: { id: 1 }, options: { name: 'idx_email_ledger_id', unique: true } },
    { key: { orgId: 1, dateTime: -1 }, options: { name: 'idx_email_ledger_org_datetime' } },
    { key: { orgId: 1, status: 1, dateTime: -1 }, options: { name: 'idx_email_ledger_org_status_datetime' } },
    { key: { orgId: 1, sectionId: 1, operationId: 1, dateTime: -1 }, options: { name: 'idx_email_ledger_org_section_operation_datetime' } },
    { key: { eventKey: 1, dateTime: -1 }, options: { name: 'idx_email_ledger_event_datetime' } },
    { key: { providerMessageId: 1 }, options: { name: 'idx_email_ledger_provider_message' } }
  ],
  passwordResetCodes: [
    { key: { id: 1 }, options: { name: 'idx_password_reset_codes_id', unique: true } },
    { key: { email: 1, status: 1, createdAt: -1 }, options: { name: 'idx_password_reset_codes_email_status_created' } },
    { key: { userId: 1, status: 1, createdAt: -1 }, options: { name: 'idx_password_reset_codes_user_status_created' } },
    { key: { status: 1, expiresAt: 1 }, options: { name: 'idx_password_reset_codes_status_expires' } },
    { key: { expiresAt: 1 }, options: { name: 'idx_password_reset_codes_expires_ttl', expireAfterSeconds: 0 } }
  ],
  helpArticles: [
    { key: { id: 1 }, options: { name: 'idx_help_articles_id' } },
    { key: { slug: 1 }, options: { name: 'idx_help_articles_slug' } },
    { key: { active: 1, category: 1 }, options: { name: 'idx_help_articles_active_category' } },
    { key: { priority: -1, updatedAt: -1 }, options: { name: 'idx_help_articles_priority_updated' } },
    { key: { active: 1, priority: -1, updatedAt: -1 }, options: { name: 'idx_help_articles_active_priority_updated' } },
    { key: { sectionId: 1, operationId: 1 }, options: { name: 'idx_help_articles_section_operation' } }
  ],
  logs: [
    { key: { id: 1 }, options: { name: 'idx_logs_id' } },
    { key: { timestamp: -1 }, options: { name: 'idx_logs_timestamp_desc' } },
    { key: { userId: 1, timestamp: -1 }, options: { name: 'idx_logs_user_timestamp' } },
    { key: { sectionId: 1, operationId: 1, timestamp: -1 }, options: { name: 'idx_logs_section_operation_timestamp' } },
    { key: { status: 1, timestamp: -1 }, options: { name: 'idx_logs_status_timestamp' } }
  ],
  actionStates: [
    { key: { id: 1 }, options: { name: 'idx_actionStates_id' } },
    { key: { createdAt: -1 }, options: { name: 'idx_actionStates_createdAt_desc' } },
    { key: { userId: 1, status: 1, createdAt: -1 }, options: { name: 'idx_actionStates_user_status_createdAt' } },
    { key: { expiresAt: 1 }, options: { name: 'idx_actionStates_expiresAt' } },
    { key: { retentionUntil: 1 }, options: { name: 'idx_actionStates_retention_ttl', expireAfterSeconds: 0 } }
  ],
  activityQuotaLedger: [
    { key: { id: 1 }, options: { name: 'idx_activity_quota_ledger_id', unique: true } },
    { key: { orgId: 1, userId: 1, section: 1 }, options: { name: 'idx_activity_quota_ledger_org_user_section' } },
    { key: { orgId: 1, userId: 1, section: 1, operation: 1, dateTime: -1 }, options: { name: 'idx_activity_quota_ledger_org_user_section_operation_dt' } },
    { key: { dateTime: -1 }, options: { name: 'idx_activity_quota_ledger_datetime_desc' } },
    {
      key: { orgId: 1, 'source.idempotencyKey': 1 },
      options: {
        name: 'idx_activity_quota_ledger_org_source_idempotency',
        unique: true,
        partialFilterExpression: {
          'source.idempotencyKey': { $exists: true, $type: 'string', $gt: '' }
        }
      }
    }
  ],
  quotaCreditLots: [
    { key: { id: 1 }, options: { name: 'idx_quota_credit_lots_id', unique: true } },
    { key: { orgId: 1, userId: 1, section: 1, operation: 1 }, options: { name: 'idx_quota_credit_lots_key' } },
    { key: { orgId: 1, userId: 1, section: 1, operation: 1, status: 1, 'validity.endDate': 1 }, options: { name: 'idx_quota_credit_lots_key_status_validity_end' } },
    { key: { creditEntryId: 1 }, options: { name: 'idx_quota_credit_lots_credit_entry' } },
    { key: { dateTime: -1 }, options: { name: 'idx_quota_credit_lots_datetime_desc' } }
  ],
  quotaBalanceSnapshots: [
    { key: { id: 1 }, options: { name: 'idx_quota_balance_snapshots_id', unique: true } },
    { key: { orgId: 1, userId: 1, section: 1, operation: 1 }, options: { name: 'idx_quota_balance_snapshots_key', unique: true } },
    { key: { orgId: 1, userId: 1, section: 1 }, options: { name: 'idx_quota_balance_snapshots_org_user_section' } },
    { key: { dateTime: -1 }, options: { name: 'idx_quota_balance_snapshots_datetime_desc' } }
  ],
  activityQuotaCreditGroups: [
    { key: { id: 1 }, options: { name: 'idx_activity_quota_credit_groups_id', unique: true } },
    { key: { orgId: 1, dateTime: -1 }, options: { name: 'idx_activity_quota_credit_groups_org_datetime' } },
    { key: { ledgerEntryIds: 1 }, options: { name: 'idx_activity_quota_credit_groups_ledger_entry_ids' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_activity_quota_credit_groups_creator_org' } }
  ],
  activityQuotaPackages: [
    { key: { id: 1 }, options: { name: 'idx_activity_quota_packages_id', unique: true } },
    { key: { orgId: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_activity_quota_packages_org_create_dt' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_activity_quota_packages_creator_org' } },
    { key: { orgId: 1, active: 1, visibility: 1 }, options: { name: 'idx_activity_quota_packages_org_active_visibility' } }
  ],
  activityQuotaPackageAssignments: [
    { key: { id: 1 }, options: { name: 'idx_activity_quota_pkg_assignments_id', unique: true } },
    { key: { orgId: 1, targetUserId: 1, status: 1, appliedAt: -1 }, options: { name: 'idx_activity_quota_pkg_assignments_org_target_status_applied' } },
    { key: { orgId: 1, packageId: 1, status: 1, appliedAt: -1 }, options: { name: 'idx_activity_quota_pkg_assignments_org_package_status_applied' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_activity_quota_pkg_assignments_creator_org' } },
    { key: { orgId: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_activity_quota_pkg_assignments_org_last_update' } }
  ],
  activityQuotaConsumptionDefinitions: [
    { key: { id: 1 }, options: { name: 'idx_activity_quota_consumption_defs_id', unique: true } },
    { key: { orgId: 1, sectionId: 1, operationId: 1, active: 1 }, options: { name: 'idx_activity_quota_consumption_defs_org_key_active' } },
    { key: { orgId: 1, sectionId: 1, operationId: 1, sourceEventType: 1, active: 1 }, options: { name: 'idx_activity_quota_consumption_defs_org_key_event_active' } },
    { key: { orgId: 1, sectionId: 1, operationId: 1, isFallback: 1, active: 1 }, options: { name: 'idx_activity_quota_consumption_defs_org_key_fallback_active' } },
    { key: { orgId: 1, targetUserIds: 1, active: 1 }, options: { name: 'idx_activity_quota_consumption_defs_org_targets_active' } },
    { key: { orgId: 1, 'validity.startDate': 1, 'validity.endDate': 1, active: 1 }, options: { name: 'idx_activity_quota_consumption_defs_org_validity_active' } },
    { key: { orgId: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_activity_quota_consumption_defs_org_last_update' } }
  ],
  publicPageContentSettings: [
    { key: { id: 1 }, options: { name: 'idx_public_page_content_settings_id', unique: true } },
    { key: { isActive: 1, updatedAt: -1 }, options: { name: 'idx_public_page_content_settings_active_updated' } }
  ],
  sessions: [
    { key: { id: 1 }, options: { name: 'idx_sessions_id' } },
    { key: { userId: 1, status: 1 }, options: { name: 'idx_sessions_user_status' } },
    { key: { userId: 1, expiresAt: 1 }, options: { name: 'idx_sessions_user_expires_at' } },
    { key: { expiresAt: 1 }, options: { name: 'idx_sessions_expiresAt' } }
  ],
  organizations: [
    { key: { id: 1 }, options: { name: 'idx_organizations_id' } },
    { key: { name: 1 }, options: { name: 'idx_organizations_name' } },
    { key: { status: 1 }, options: { name: 'idx_organizations_status' } }
  ],
  persons: [
    { key: { id: 1 }, options: { name: 'idx_persons_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_persons_org_status' } },
    { key: { firstName: 1, lastName: 1 }, options: { name: 'idx_persons_name' } }
  ],
  schoolClasses: [
    { key: { id: 1 }, options: { name: 'idx_school_classes_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_school_classes_org_status' } },
    { key: { orgId: 1, registrationMode: 1, isClosedForNewEnrollment: 1 }, options: { name: 'idx_school_classes_org_mode_closed' } },
    { key: { orgId: 1, cycleGroupId: 1, cycleNo: 1 }, options: { name: 'idx_school_classes_org_cycle_group_no' } },
    { key: { orgId: 1, registrationMode: 1, cycleGroupId: 1, cycleNo: 1 }, options: { name: 'idx_school_classes_org_mode_cycle_group_no' } },
    { key: { orgId: 1, cycleStartDate: 1, cycleEndDate: 1 }, options: { name: 'idx_school_classes_org_cycle_dates' } },
    { key: { 'enrollment.students.studentId': 1, orgId: 1 }, options: { name: 'idx_school_classes_enrollment_student_org' } }
  ],
  schoolClassEnrollmentPeriods: [
    { key: { id: 1 }, options: { name: 'idx_school_class_enrollment_periods_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_school_class_enrollment_periods_org_status' } },
    { key: { orgId: 1, classId: 1, studentId: 1, startDate: 1, endDate: 1 }, options: { name: 'idx_school_class_enrollment_periods_org_class_student_dates' } },
    { key: { orgId: 1, studentId: 1, status: 1 }, options: { name: 'idx_school_class_enrollment_periods_org_student_status' } },
    { key: { orgId: 1, classId: 1, status: 1 }, options: { name: 'idx_school_class_enrollment_periods_org_class_status' } },
    { key: { orgId: 1, classId: 1, status: 1, startDate: 1, endDate: 1 }, options: { name: 'idx_school_class_enrollment_periods_org_class_status_dates' } },
    { key: { orgId: 1, studentId: 1, status: 1, startDate: 1, endDate: 1 }, options: { name: 'idx_school_class_enrollment_periods_org_student_status_dates' } },
    { key: { classId: 1, studentId: 1, startDate: 1, endDate: 1 }, options: { name: 'idx_school_class_enrollment_periods_class_student_dates' } }
  ],
  schoolStudentProgramRegistrations: [
    { key: { id: 1 }, options: { name: 'idx_school_program_regs_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_school_program_regs_org_status' } },
    { key: { orgId: 1, studentId: 1, programId: 1, status: 1 }, options: { name: 'idx_school_program_regs_org_student_program_status' } },
    { key: { orgId: 1, registrationDate: -1 }, options: { name: 'idx_school_program_regs_org_registrationDate' } }
  ],
  schoolStudentTermRegistrations: [
    { key: { id: 1 }, options: { name: 'idx_school_term_regs_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_school_term_regs_org_status' } },
    { key: { orgId: 1, studentId: 1, programId: 1, termId: 1, status: 1 }, options: { name: 'idx_school_term_regs_org_student_program_term_status' } },
    { key: { orgId: 1, registrationDate: -1 }, options: { name: 'idx_school_term_regs_org_registrationDate' } }
  ],
  schoolExamTemplates: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_templates_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_school_exam_templates_org_status' } },
    { key: { orgId: 1, ownerTeacherId: 1, status: 1 }, options: { name: 'idx_school_exam_templates_org_owner_status' } },
    { key: { orgId: 1, code: 1 }, options: { name: 'idx_school_exam_templates_org_code' } }
  ],
  schoolExamRevisions: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_revisions_id' } },
    { key: { orgId: 1, templateId: 1, revisionNo: 1 }, options: { name: 'idx_school_exam_revisions_org_template_revision' } },
    { key: { orgId: 1, templateId: 1, status: 1 }, options: { name: 'idx_school_exam_revisions_org_template_status' } },
    { key: { orgId: 1, status: 1, publishedAt: -1 }, options: { name: 'idx_school_exam_revisions_org_status_published' } }
  ],
  schoolExamQuestions: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_questions_id' } },
    { key: { orgId: 1, revisionId: 1, sequenceNo: 1 }, options: { name: 'idx_school_exam_questions_org_revision_sequence' } },
    { key: { orgId: 1, templateId: 1, revisionId: 1 }, options: { name: 'idx_school_exam_questions_org_template_revision' } },
    { key: { orgId: 1, questionType: 1, status: 1 }, options: { name: 'idx_school_exam_questions_org_type_status' } }
  ],
  schoolExamAllocations: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_allocations_id' } },
    { key: { orgId: 1, classId: 1, status: 1 }, options: { name: 'idx_school_exam_allocations_org_class_status' } },
    { key: { orgId: 1, revisionId: 1, status: 1 }, options: { name: 'idx_school_exam_allocations_org_revision_status' } },
    { key: { orgId: 1, windowStartUtc: 1, windowEndUtc: 1 }, options: { name: 'idx_school_exam_allocations_org_windows' } }
  ],
  schoolExamAssignments: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_assignments_id' } },
    { key: { orgId: 1, allocationId: 1, studentId: 1, status: 1 }, options: { name: 'idx_school_exam_assignments_org_allocation_student_status' } },
    { key: { orgId: 1, studentId: 1, status: 1, startWindowUtc: 1 }, options: { name: 'idx_school_exam_assignments_org_student_status_start' } },
    { key: { orgId: 1, classId: 1, allocationId: 1 }, options: { name: 'idx_school_exam_assignments_org_class_allocation' } }
  ],
  schoolExamAttempts: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_attempts_id' } },
    { key: { orgId: 1, assignmentId: 1, status: 1, startedAtUtc: -1 }, options: { name: 'idx_school_exam_attempts_org_assignment_status_started' } },
    { key: { orgId: 1, studentId: 1, status: 1, startedAtUtc: -1 }, options: { name: 'idx_school_exam_attempts_org_student_status_started' } },
    { key: { orgId: 1, allocationId: 1, status: 1 }, options: { name: 'idx_school_exam_attempts_org_allocation_status' } }
  ],
  schoolExamAnswers: [
    { key: { id: 1 }, options: { name: 'idx_school_exam_answers_id' } },
    { key: { orgId: 1, attemptId: 1, questionId: 1 }, options: { name: 'idx_school_exam_answers_org_attempt_question', unique: true } },
    { key: { orgId: 1, attemptId: 1, status: 1 }, options: { name: 'idx_school_exam_answers_org_attempt_status' } },
    { key: { orgId: 1, assignmentId: 1, studentId: 1 }, options: { name: 'idx_school_exam_answers_org_assignment_student' } }
  ],
  schoolGlobalTransactions: [
    { key: { id: 1 }, options: { name: 'idx_school_global_transactions_id' } },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_school_global_transactions_org_status' } },
    { key: { orgId: 1, journalId: 1, status: 1 }, options: { name: 'idx_school_global_transactions_org_journal_status' } },
    { key: { orgId: 1, effectiveDate: -1 }, options: { name: 'idx_school_global_transactions_org_effectiveDate' } },
    { key: { sourceEventId: 1, sourceIdempotencyKey: 1 }, options: { name: 'idx_school_global_transactions_source_event_idempotency' } }
  ],
  ieltsMicroAssessments: [
    { key: { id: 1 }, options: { name: 'idx_ielts_micro_assessments_id', unique: true } },
    {
      key: { orgId: 1, baseKey: 1 },
      options: {
        name: 'idx_ielts_micro_assessments_org_basekey',
        unique: true,
        partialFilterExpression: {
          baseKey: { $exists: true, $type: 'string', $gt: '' }
        }
      }
    },
    { key: { orgId: 1, is_active: 1, criterion: 1, band: 1 }, options: { name: 'idx_ielts_micro_assessments_org_active_criterion_band' } }
  ],
  benchpathTasks: [
    { key: { id: 1 }, options: { name: 'idx_bp_tasks_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1 }, options: { name: 'idx_bp_tasks_org_status_updated' } },
    { key: { skill: 1, selectedBenchmarkId: 1 }, options: { name: 'idx_bp_tasks_skill_benchmark' } }
  ],
  benchpathSources: [
    { key: { id: 1 }, options: { name: 'idx_bp_sources_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_sources_org_status_updated' } },
    { key: { sourceType: 1, authorityLevel: 1 }, options: { name: 'idx_bp_sources_type_authority' } }
  ],
  benchpathSourceFragments: [
    { key: { id: 1 }, options: { name: 'idx_bp_fragments_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_fragments_org_status_updated' } },
    { key: { sourceId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_fragments_source_status_updated' } },
    { key: { mappedEntityType: 1, semanticRole: 1 }, options: { name: 'idx_bp_fragments_entity_role' } }
  ],
  benchpathClbFrameworks: [
    { key: { id: 1 }, options: { name: 'idx_bp_frameworks_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_frameworks_org_status_updated' } },
    { key: { frameworkType: 1, language: 1, status: 1 }, options: { name: 'idx_bp_frameworks_type_language_status' } }
  ],
  benchpathClbStages: [
    { key: { id: 1 }, options: { name: 'idx_bp_stages_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_stages_org_status_updated' } },
    { key: { frameworkId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_stages_framework_status_updated' } }
  ],
  benchpathClbSkills: [
    { key: { id: 1 }, options: { name: 'idx_bp_skills_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_skills_org_status_updated' } },
    { key: { frameworkId: 1, modality: 1, status: 1 }, options: { name: 'idx_bp_skills_framework_modality_status' } }
  ],
  benchpathClbCompetencyAreas: [
    { key: { id: 1 }, options: { name: 'idx_bp_comp_areas_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_comp_areas_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, status: 1 }, options: { name: 'idx_bp_comp_areas_framework_skill_status' } }
  ],
  benchpathClbBenchmarks: [
    { key: { id: 1 }, options: { name: 'idx_bp_benchmarks_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_benchmarks_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, benchmarkNumber: 1, status: 1 }, options: { name: 'idx_bp_benchmarks_framework_skill_no_status' } }
  ],
  benchpathClbCompetencies: [
    { key: { id: 1 }, options: { name: 'idx_bp_competencies_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_competencies_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, benchmarkId: 1, competencyAreaId: 1, status: 1 }, options: { name: 'idx_bp_competencies_framework_skill_benchmark_area_status' } }
  ],
  benchpathClbIndicators: [
    { key: { id: 1 }, options: { name: 'idx_bp_indicators_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_indicators_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, benchmarkId: 1, competencyId: 1, status: 1 }, options: { name: 'idx_bp_indicators_framework_skill_benchmark_comp_status' } }
  ],
  benchpathClbProfileOfAbility: [
    { key: { id: 1 }, options: { name: 'idx_bp_profile_ability_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_profile_ability_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, benchmarkId: 1, status: 1 }, options: { name: 'idx_bp_profile_ability_framework_skill_benchmark_status' } }
  ],
  benchpathClbFeaturesOfCommunication: [
    { key: { id: 1 }, options: { name: 'idx_bp_features_comm_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_features_comm_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, benchmarkId: 1, scopeType: 1, status: 1 }, options: { name: 'idx_bp_features_comm_framework_skill_benchmark_scope_status' } }
  ],
  benchpathClbSampleTaskLabels: [
    { key: { id: 1 }, options: { name: 'idx_bp_sample_task_labels_id' } },
    { key: { orgId: 1, status: 1, updatedAt: -1, id: -1 }, options: { name: 'idx_bp_sample_task_labels_org_status_updated' } },
    { key: { frameworkId: 1, skillId: 1, linkedBenchmarkId: 1, linkedCompetencyId: 1, status: 1 }, options: { name: 'idx_bp_sample_task_labels_framework_skill_links_status' } }
  ],
  ieltsScoringHistory: [
    { key: { id: 1 }, options: { name: 'idx_ielts_history_id' } },
    { key: { orgId: 1, savedAt: -1 }, options: { name: 'idx_ielts_history_org_saved' } },
    { key: { orgId: 1, userId: 1, savedAt: -1 }, options: { name: 'idx_ielts_history_org_user_saved' } },
    { key: { orgId: 1, isArchived: 1, savedAt: -1 }, options: { name: 'idx_ielts_history_org_archived_saved' } },
    { key: { orgId: 1, pipelineMode: 1, scoringView: 1, savedAt: -1 }, options: { name: 'idx_ielts_history_org_mode_view_saved' } },
    { key: { orgId: 1, sampleId: 1, savedAt: -1 }, options: { name: 'idx_ielts_history_org_sample_saved' } },
    { key: { scoringView: 1, createdAt: -1 }, options: { name: 'idx_ielts_history_view_created' } },
    { key: { sampleId: 1, createdAt: -1 }, options: { name: 'idx_ielts_history_sample_created' } }
  ],
  ieltsApiProviders: [
    { key: { id: 1 }, options: { name: 'idx_ielts_api_providers_id' } },
    { key: { userId: 1, isActive: 1, isDefault: 1 }, options: { name: 'idx_ielts_api_providers_user_default' } },
    { key: { userId: 1, providerId: 1, updatedAt: -1 }, options: { name: 'idx_ielts_api_providers_user_provider_updated' } },
    { key: { orgId: 1, userId: 1 }, options: { name: 'idx_ielts_api_providers_org_user' } }
  ],
  ieltsAiTokenUsages: [
    { key: { id: 1 }, options: { name: 'idx_ielts_ai_usage_id' } },
    { key: { orgId: 1, consumedAt: -1 }, options: { name: 'idx_ielts_ai_usage_org_consumed' } },
    { key: { orgId: 1, userId: 1, consumedAt: -1 }, options: { name: 'idx_ielts_ai_usage_org_user_consumed' } },
    { key: { providerId: 1, modelUsed: 1, consumedAt: -1 }, options: { name: 'idx_ielts_ai_usage_provider_model_consumed' } },
    { key: { billingStatus: 1, consumedAt: -1 }, options: { name: 'idx_ielts_ai_usage_billing_consumed' } }
  ]
});

const STARTUP_INDEX_GROUPS = Object.freeze({
  actionStateRetention: {
    label: 'ActionState Retention',
    collections: {
      actionStates: [
        'idx_actionStates_retention_ttl',
        'idx_actionStates_user_status_createdAt'
      ]
    }
  },
  phase7RollingEnrollment: {
    label: 'Phase7 Rolling Enrollment',
    collections: {
      schoolClassEnrollmentPeriods: [
        'idx_school_class_enrollment_periods_org_class_student_dates',
        'idx_school_class_enrollment_periods_org_student_status',
        'idx_school_class_enrollment_periods_org_class_status'
      ],
      schoolClasses: [
        'idx_school_classes_org_mode_cycle_group_no',
        'idx_school_classes_org_cycle_dates'
      ]
    }
  },
  phaseExamBuilderFoundation: {
    label: 'Exam Builder Foundation',
    collections: {
      schoolExamTemplates: [
        'idx_school_exam_templates_org_status',
        'idx_school_exam_templates_org_owner_status'
      ],
      schoolExamRevisions: [
        'idx_school_exam_revisions_org_template_revision',
        'idx_school_exam_revisions_org_status_published'
      ],
      schoolExamQuestions: [
        'idx_school_exam_questions_org_revision_sequence'
      ],
      schoolExamAllocations: [
        'idx_school_exam_allocations_org_class_status',
        'idx_school_exam_allocations_org_windows'
      ],
      schoolExamAssignments: [
        'idx_school_exam_assignments_org_allocation_student_status',
        'idx_school_exam_assignments_org_student_status_start'
      ],
      schoolExamAttempts: [
        'idx_school_exam_attempts_org_assignment_status_started'
      ],
      schoolExamAnswers: [
        'idx_school_exam_answers_org_attempt_question',
        'idx_school_exam_answers_org_attempt_status'
      ]
    }
  }
});

function buildCreateIndexesPayload(specs = []) {
  return (Array.isArray(specs) ? specs : [])
    .map((spec) => {
      const key = spec?.key && typeof spec.key === 'object' ? spec.key : null;
      if (!key || Object.keys(key).length === 0) return null;
      return {
        key,
        ...(spec?.options && typeof spec.options === 'object' ? spec.options : {})
      };
    })
    .filter(Boolean);
}

function getIndexDefinitions(options = {}) {
  if (options?.includePackageIndexes !== false) {
    packageMongoIndexRegistry.loadMongoIndexDefinitionsFromPackageManifests(options);
  }
  return packageMongoIndexRegistry.mergeMongoIndexDefinitions(INDEX_DEFINITIONS);
}

function logStartupIndexGroupSummary(report, definitions) {
  const collectionMap = new Map((Array.isArray(report) ? report : []).map((row) => [String(row?.collection || ''), row]));
  const defs = definitions && typeof definitions === 'object' ? definitions : {};

  for (const group of Object.values(STARTUP_INDEX_GROUPS)) {
    const groupLabel = String(group?.label || 'Index Group').trim();
    const collections = group?.collections && typeof group.collections === 'object' ? group.collections : {};
    startupLogger.info('MONGOINDEX', groupLabel, 'Summary start.');

    for (const [collectionName, targetIndexNames] of Object.entries(collections)) {
      const reportRow = collectionMap.get(collectionName);
      const specs = Array.isArray(defs[collectionName]) ? defs[collectionName] : [];
      const definitionNames = new Set(
        specs
          .map((spec) => String(spec?.options?.name || '').trim())
          .filter(Boolean)
      );
      const targets = Array.isArray(targetIndexNames) ? targetIndexNames : [];
      const matchedTargets = targets.filter((name) => definitionNames.has(name));
      const missingTargets = targets.filter((name) => !definitionNames.has(name));
      const status = reportRow?.ok ? 'OK' : 'FAILED';

      const details = [
        `${collectionName}`,
        `status=${status}`,
        `targeted=${matchedTargets.length}/${targets.length}`,
        `requested=${Number(reportRow?.requested || 0)}`,
        `created=${Number(reportRow?.created || 0)}`
      ];
      if (reportRow?.error) details.push(`error=${String(reportRow.error)}`);
      startupLogger.info('MONGOINDEX', groupLabel, `${collectionName} summary.`, {
        status,
        targeted: `${matchedTargets.length}/${targets.length}`,
        requested: Number(reportRow?.requested || 0),
        created: Number(reportRow?.created || 0),
        ...(reportRow?.error ? { error: String(reportRow.error) } : {})
      });

      if (matchedTargets.length) {
        startupLogger.info('MONGOINDEX', groupLabel, `${collectionName} target indexes.`, {
          indexes: matchedTargets.join(', ')
        });
      }
      if (missingTargets.length) {
        startupLogger.warn('MONGOINDEX', groupLabel, `${collectionName} missing target definitions.`, {
          indexes: missingTargets.join(', ')
        });
      }
    }

    startupLogger.info('MONGOINDEX', groupLabel, 'Summary end.');
  }
}

async function ensureMongoIndexes(db, options = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('Mongo DB handle is required for index initialization.');
  }

  const enabled = isEnabled(options?.enabled ?? process.env.MONGO_ENSURE_INDEXES, true);
  const verbose = isEnabled(options?.verbose ?? process.env.MONGO_ENSURE_INDEXES_VERBOSE, true);
  if (!enabled) {
    if (verbose) startupLogger.warn('MONGOINDEX', 'BOOT', 'Skipped because MONGO_ENSURE_INDEXES is disabled.');
    return { enabled: false, collections: [] };
  }

  const report = [];
  const definitions = options?.definitions && typeof options.definitions === 'object'
    ? options.definitions
    : getIndexDefinitions(options);

  for (const [collectionName, specs] of Object.entries(definitions)) {
    const indexes = buildCreateIndexesPayload(specs);
    if (!indexes.length) continue;

    try {
      const result = await db.collection(collectionName).createIndexes(indexes);
      report.push({
        collection: collectionName,
        ok: true,
        requested: indexes.length,
        created: Array.isArray(result) ? result.length : 0,
        createdNames: Array.isArray(result) ? result : []
      });
    } catch (error) {
      report.push({
        collection: collectionName,
        ok: false,
        requested: indexes.length,
        created: 0,
        error: error.message
      });
      if (verbose) {
        startupLogger.warn('MONGOINDEX', 'CREATE', 'Collection index creation failed.', {
          collection: collectionName,
          error: error.message
        });
      }
    }
  }

  if (verbose) {
    const ok = report.filter((r) => r.ok).length;
    const failed = report.length - ok;
    startupLogger.success('MONGOINDEX', 'BOOT', 'Completed index initialization.', { success: ok, failed });
    logStartupIndexGroupSummary(report, definitions);
  }

  return { enabled: true, collections: report };
}

module.exports = {
  INDEX_DEFINITIONS,
  getIndexDefinitions,
  ensureMongoIndexes
};
