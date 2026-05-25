module.exports = Object.freeze({
  pteApplicants: [
    { key: { id: 1 }, options: { name: 'idx_pte_applicants_id', unique: true } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_pte_applicants_org_status_create_dt' } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_applicants_org_status_create_dt_id' } },
    { key: { orgId: 1, personId: 1 }, options: { name: 'idx_pte_applicants_org_person' } },
    { key: { orgId: 1, userId: 1 }, options: { name: 'idx_pte_applicants_org_user' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_pte_applicants_creator_org' } }
  ],
  pteTeachers: [
    { key: { id: 1 }, options: { name: 'idx_pte_teachers_id', unique: true } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_pte_teachers_org_status_create_dt' } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_teachers_org_status_create_dt_id' } },
    { key: { orgId: 1, personId: 1 }, options: { name: 'idx_pte_teachers_org_person', unique: true } },
    { key: { orgId: 1, userId: 1 }, options: { name: 'idx_pte_teachers_org_user' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_pte_teachers_creator_org' } },
    { key: { orgId: 1, 'audit.lastUpdateDateTime': -1 }, options: { name: 'idx_pte_teachers_org_last_update_dt' } }
  ],
  pteCourses: [
    { key: { id: 1 }, options: { name: 'idx_pte_courses_id', unique: true } },
    {
      key: { orgId: 1, code: 1 },
      options: {
        name: 'idx_pte_courses_org_code',
        unique: true,
        partialFilterExpression: {
          code: { $exists: true, $type: 'string', $gt: '' }
        }
      }
    },
    { key: { orgId: 1, status: 1 }, options: { name: 'idx_pte_courses_org_status' } },
    { key: { orgId: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_courses_org_create_dt_id' } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_courses_org_status_create_dt_id' } },
    { key: { orgId: 1, startDate: 1 }, options: { name: 'idx_pte_courses_org_start_date' } },
    { key: { orgId: 1, endDate: 1 }, options: { name: 'idx_pte_courses_org_end_date' } }
  ],
  pteAiProviders: [
    { key: { id: 1 }, options: { name: 'idx_pte_ai_providers_id', unique: true } },
    {
      key: { orgId: 1, userId: 1, isDefault: 1 },
      options: {
        name: 'idx_pte_ai_providers_org_user_default_unique',
        unique: true,
        partialFilterExpression: { isDefault: true }
      }
    },
    { key: { orgId: 1, userId: 1, isActive: 1, updatedAt: -1 }, options: { name: 'idx_pte_ai_providers_org_user_active_updated' } },
    { key: { orgId: 1, userId: 1, providerId: 1, updatedAt: -1 }, options: { name: 'idx_pte_ai_providers_org_user_provider_updated' } }
  ],
  pteAiScoringSettings: [
    { key: { id: 1 }, options: { name: 'idx_pte_ai_scoring_settings_id', unique: true } },
    { key: { orgId: 1, questionType: 1 }, options: { name: 'idx_pte_ai_scoring_settings_org_question_unique', unique: true } },
    { key: { orgId: 1, isActive: 1, updatedAt: -1 }, options: { name: 'idx_pte_ai_scoring_settings_org_active_updated' } },
    { key: { providerRecordId: 1 }, options: { name: 'idx_pte_ai_scoring_settings_provider_record' } }
  ],
  ptePublicPageSettings: [
    { key: { id: 1 }, options: { name: 'idx_pte_public_page_settings_id', unique: true } },
    { key: { orgId: 1 }, options: { name: 'idx_pte_public_page_settings_org_unique', unique: true } },
    { key: { orgId: 1, isActive: 1, updatedAt: -1 }, options: { name: 'idx_pte_public_page_settings_org_active_updated' } }
  ],
  pteAiTokenUsages: [
    { key: { id: 1 }, options: { name: 'idx_pte_ai_usage_id', unique: true } },
    { key: { orgId: 1, consumedAt: -1 }, options: { name: 'idx_pte_ai_usage_org_consumed' } },
    { key: { orgId: 1, userId: 1, consumedAt: -1 }, options: { name: 'idx_pte_ai_usage_org_user_consumed' } },
    { key: { orgId: 1, section: 1, operation: 1, consumedAt: -1 }, options: { name: 'idx_pte_ai_usage_org_section_operation_consumed' } },
    { key: { orgId: 1, objectId: 1, consumedAt: -1 }, options: { name: 'idx_pte_ai_usage_org_object_consumed' } },
    { key: { providerId: 1, modelUsed: 1, consumedAt: -1 }, options: { name: 'idx_pte_ai_usage_provider_model_consumed' } },
    { key: { status: 1, consumedAt: -1 }, options: { name: 'idx_pte_ai_usage_status_consumed' } }
  ],
  pteApplicantPackageAssignments: [
    { key: { id: 1 }, options: { name: 'idx_pte_assignments_id', unique: true } },
    { key: { orgId: 1, applicantId: 1, status: 1, appliedAt: -1 }, options: { name: 'idx_pte_assignments_org_applicant_status_applied' } },
    { key: { orgId: 1, userId: 1, status: 1 }, options: { name: 'idx_pte_assignments_org_user_status' } },
    { key: { orgId: 1, packageId: 1, status: 1 }, options: { name: 'idx_pte_assignments_org_package_status' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_pte_assignments_creator_org' } }
  ],
  pteQuestionVersions: [
    { key: { id: 1 }, options: { name: 'idx_pte_questions_id', unique: true } },
    { key: { orgId: 1, familyId: 1, revisionNumber: 1 }, options: { name: 'idx_pte_questions_org_family_revision', unique: true } },
    { key: { familyId: 1, isLatestRevision: 1 }, options: { name: 'idx_pte_questions_family_latest' } },
    { key: { orgId: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_questions_org_create_dt_id' } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_questions_org_status_create_dt_id' } },
    { key: { orgId: 1, status: 1, practiceEnabled: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_questions_org_status_practice_create_dt_id' } },
    { key: { orgId: 1, status: 1, skill: 1, questionType: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_pte_questions_org_status_skill_type_create' } },
    { key: { orgId: 1, testType: 1, status: 1, skill: 1, questionType: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_pte_questions_org_test_type_status_skill_qtype_create' } },
    { key: { orgId: 1, status: 1, practiceEnabled: 1, skill: 1, questionType: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_pte_questions_org_status_practice_skill_type_create' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_pte_questions_creator_org' } },
    { key: { orgId: 1, code: 1 }, options: { name: 'idx_pte_questions_org_code' } },
    { key: { status: 1, 'publishingMeta.publishedAt': -1 }, options: { name: 'idx_pte_questions_status_published_at' } }
  ],
  pteTestVersions: [
    { key: { id: 1 }, options: { name: 'idx_pte_tests_id', unique: true } },
    { key: { orgId: 1, familyId: 1, revisionNumber: 1 }, options: { name: 'idx_pte_tests_org_family_revision', unique: true } },
    { key: { familyId: 1, isLatestRevision: 1 }, options: { name: 'idx_pte_tests_family_latest' } },
    { key: { orgId: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_tests_org_create_dt_id' } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1, id: -1 }, options: { name: 'idx_pte_tests_org_status_create_dt_id' } },
    { key: { orgId: 1, status: 1, 'audit.createDateTime': -1 }, options: { name: 'idx_pte_tests_org_status_create' } },
    { key: { 'creator.userId': 1, orgId: 1 }, options: { name: 'idx_pte_tests_creator_org' } },
    { key: { orgId: 1, code: 1 }, options: { name: 'idx_pte_tests_org_code' } },
    { key: { status: 1, 'publishingMeta.publishedAt': -1 }, options: { name: 'idx_pte_tests_status_published' } }
  ],
  pteAttemptSessions: [
    { key: { id: 1 }, options: { name: 'idx_pte_attempt_sessions_id', unique: true } },
    { key: { orgId: 1, userId: 1, startedAt: -1 }, options: { name: 'idx_pte_attempt_sessions_org_user_started' } },
    { key: { orgId: 1, attemptType: 1, status: 1, startedAt: -1 }, options: { name: 'idx_pte_attempt_sessions_org_type_status_started' } },
    { key: { orgId: 1, applicantId: 1, startedAt: -1 }, options: { name: 'idx_pte_attempt_sessions_org_applicant_started' } },
    { key: { orgId: 1, testVersionId: 1, startedAt: -1 }, options: { name: 'idx_pte_attempt_sessions_org_test_started' } }
  ],
  pteAttemptItems: [
    { key: { id: 1 }, options: { name: 'idx_pte_attempt_items_id', unique: true } },
    { key: { orgId: 1, attemptSessionId: 1, questionOrder: 1 }, options: { name: 'idx_pte_attempt_items_org_session_order' } },
    { key: { orgId: 1, userId: 1, startedAt: -1 }, options: { name: 'idx_pte_attempt_items_org_user_started' } },
    { key: { orgId: 1, attemptType: 1, status: 1, skill: 1, startedAt: -1 }, options: { name: 'idx_pte_attempt_items_org_type_status_skill_started' } },
    { key: { orgId: 1, questionVersionId: 1, finishedAt: -1 }, options: { name: 'idx_pte_attempt_items_org_question_finished' } },
    { key: { orgId: 1, skill: 1, questionType: 1, finishedAt: -1 }, options: { name: 'idx_pte_attempt_items_org_skill_type_finished' } },
    { key: { orgId: 1, feedbackProvidedAt: -1 }, options: { name: 'idx_pte_attempt_items_org_feedback_at' } }
  ],
  pteAttemptLedgerEvents: [
    { key: { id: 1 }, options: { name: 'idx_pte_attempt_events_id', unique: true } },
    { key: { orgId: 1, attemptSessionId: 1, eventAt: -1 }, options: { name: 'idx_pte_attempt_events_org_session_eventat' } },
    { key: { orgId: 1, attemptSessionId: 1, attemptItemId: 1, eventAt: 1 }, options: { name: 'idx_pte_attempt_events_org_session_item_eventat' } },
    { key: { orgId: 1, userId: 1, eventAt: -1 }, options: { name: 'idx_pte_attempt_events_org_user_eventat' } },
    { key: { orgId: 1, attemptType: 1, eventType: 1, eventAt: -1 }, options: { name: 'idx_pte_attempt_events_org_type_event_eventat' } },
    { key: { eventAt: -1 }, options: { name: 'idx_pte_attempt_events_eventat_desc' } },
    { key: { orgId: 1, questionVersionId: 1, eventAt: -1 }, options: { name: 'idx_pte_attempt_events_org_question_eventat' } },
    { key: { orgId: 1, skill: 1, questionType: 1, eventAt: -1 }, options: { name: 'idx_pte_attempt_events_org_skill_type_eventat' } },
    { key: { orgId: 1, feedbackProvidedAt: -1 }, options: { name: 'idx_pte_attempt_events_org_feedback_at' } },
    {
      key: { orgId: 1, 'source.idempotencyKey': 1 },
      options: {
        name: 'idx_pte_attempt_events_org_source_idempotency',
        unique: true,
        partialFilterExpression: {
          'source.idempotencyKey': { $exists: true, $type: 'string', $gt: '' }
        }
      }
    }
  ],
  pteAttemptArtifacts: [
    { key: { id: 1 }, options: { name: 'idx_pte_attempt_artifacts_id', unique: true } },
    { key: { orgId: 1, attemptSessionId: 1, createdAt: -1 }, options: { name: 'idx_pte_attempt_artifacts_org_session_created' } },
    { key: { orgId: 1, attemptItemId: 1, createdAt: -1 }, options: { name: 'idx_pte_attempt_artifacts_org_item_created' } },
    { key: { orgId: 1, userId: 1, createdAt: -1 }, options: { name: 'idx_pte_attempt_artifacts_org_user_created' } },
    { key: { orgId: 1, clientArtifactId: 1 }, options: { name: 'idx_pte_attempt_artifacts_org_client_artifact' } }
  ]
});
