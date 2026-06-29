(function registerGenericPickerPresets(global) {
  const contexts = global.GenericPickerContexts || {};

  const presetMap = {
    accessProfile: {
      title: 'Select Access Profile',
      icon: 'bi-shield-lock',
      apiEndpoint: '/accesses',
      placeholder: 'Search access profiles...'
    },
    account: {
      title: 'Select Account',
      icon: 'bi-wallet2',
      apiEndpoint: '/school/accounts',
      placeholder: 'Search accounts...'
    },
    class: {
      title: 'Select Class',
      icon: 'bi-easel-fill',
      apiEndpoint: '/school/classes',
      placeholder: 'Search classes...'
    },
    clbBenchmark: {
      title: 'Select Benchmark',
      icon: 'bi-123',
      apiEndpoint: '/benchpath/clb-benchmarks',
      placeholder: 'Search benchmarks...'
    },
    clbCompetencyArea: {
      title: 'Select Competency Area',
      icon: 'bi-diagram-3',
      apiEndpoint: '/benchpath/clb-competency-areas',
      placeholder: 'Search competency areas...'
    },
    clbCompetency: {
      title: 'Select Competency',
      icon: 'bi-ui-checks',
      apiEndpoint: '/benchpath/clb-competencies',
      placeholder: 'Search competencies...'
    },
    clbFeatureOfCommunication: {
      title: 'Select Feature Of Communication',
      icon: 'bi-chat-square-text',
      apiEndpoint: '/benchpath/clb-features-of-communication',
      placeholder: 'Search communication features...'
    },
    clbFramework: {
      title: 'Select Framework',
      icon: 'bi-diagram-2-fill',
      apiEndpoint: '/benchpath/clb-framework',
      placeholder: 'Search frameworks...'
    },
    clbIndicator: {
      title: 'Select Indicator',
      icon: 'bi-bullseye',
      apiEndpoint: '/benchpath/clb-indicators',
      placeholder: 'Search indicators...'
    },
    clbProfileOfAbility: {
      title: 'Select Profile Of Ability',
      icon: 'bi-person-lines-fill',
      apiEndpoint: '/benchpath/clb-profile-of-ability',
      placeholder: 'Search profiles of ability...'
    },
    clbSampleTaskLabel: {
      title: 'Select Sample Task Label',
      icon: 'bi-card-list',
      apiEndpoint: '/benchpath/clb-sample-task-labels',
      placeholder: 'Search sample task labels...'
    },
    clbStage: {
      title: 'Select Stage',
      icon: 'bi-signpost-split-fill',
      apiEndpoint: '/benchpath/clb-stages',
      placeholder: 'Search stages...'
    },
    clbSkill: {
      title: 'Select Skill',
      icon: 'bi-list-check',
      apiEndpoint: '/benchpath/clb-skills',
      placeholder: 'Search skills...'
    },
    department: {
      title: 'Select Department',
      icon: 'bi-diagram-3-fill',
      apiEndpoint: '/school/departments/api/data',
      placeholder: 'Search departments...'
    },
    term: {
      title: 'Select Term',
      icon: 'bi-calendar3-range-fill',
      apiEndpoint: '/school/terms',
      placeholder: 'Search terms...'
    },
    transactionDefinition: {
      title: 'Select Transaction Template',
      icon: 'bi-receipt-cutoff',
      apiEndpoint: '/school/transactionTemplates',
      placeholder: 'Search transaction templates...'
    },
    transactionTemplate: {
      title: 'Select Transaction Template',
      icon: 'bi-receipt-cutoff',
      apiEndpoint: '/school/transactionTemplates',
      placeholder: 'Search transaction templates...'
    },
    group: {
      title: 'Select Group',
      icon: 'bi-collection',
      apiEndpoint: '/subscriptiongroup',
      placeholder: 'Search groups...'
    },
    helpPage: {
      title: 'Select Help Page',
      icon: 'bi-file-earmark-richtext',
      apiEndpoint: '/help/manage/pages',
      placeholder: 'Search help pages...'
    },
    microAssessment: {
      title: 'Select Assessment',
      icon: 'bi-card-checklist',
      apiEndpoint: '/ielts/microAssessments',
      placeholder: 'Search assessments...',
      searchFields: 'question_key,title,atomic_question,criterion,prompt_group,signal_kind'
    },
    ieltsApiProvider: {
      title: 'Select Default API',
      icon: 'bi-key-fill',
      apiEndpoint: '/ielts/api-providers',
      placeholder: 'Search API providers (type --- to show all)...',
      searchFields: 'id,name,providerId,modelId,notes'
    },
    pteApiProvider: {
      title: 'Select Default API',
      icon: 'bi-key-fill',
      apiEndpoint: '/pte/ai-assisst/api-providers',
      placeholder: 'Search API providers...',
      searchFields: 'id,name,providerId,modelId,project,location,notes'
    },
    organization: {
      title: 'Select Organization',
      icon: 'bi-building',
      apiEndpoint: '/organizations',
      placeholder: 'Search organizations...'
    },
    operation: {
      title: 'Select Operation',
      icon: 'bi-gear',
      apiEndpoint: '/operations',
      placeholder: 'Search operations...'
    },
    person: {
      title: 'Select Person',
      icon: 'bi-person-badge',
      apiEndpoint: '/persons',
      placeholder: 'Search person...'
    },
    program: {
      title: 'Select Program',
      icon: 'bi-journal-bookmark-fill',
      apiEndpoint: '/school/programs',
      placeholder: 'Search programs...'
    },
    section: {
      title: 'Select Section',
      icon: 'bi-collection',
      apiEndpoint: '/sections',
      placeholder: 'Search sections...'
    },
    session: {
      title: 'Select Session',
      icon: 'bi-calendar3',
      apiEndpoint: '/school/sessions',
      placeholder: 'Search sessions...'
    },
    sessionStatus: {
      title: 'Select Session Status',
      icon: 'bi-sliders',
      apiEndpoint: '/school/session-statuses',
      placeholder: 'Search session statuses...'
    },
    student: {
      title: 'Select Student',
      icon: 'bi-person-vcard',
      apiEndpoint: '/school/students',
      placeholder: 'Search students...'
    },
    subject: {
      title: 'Select Subject',
      icon: 'bi-book',
      apiEndpoint: '/school/subjects',
      placeholder: 'Search subjects...'
    },
    teacher: {
      title: 'Select Teacher',
      icon: 'bi-person-workspace',
      apiEndpoint: '/school/teachers',
      placeholder: 'Search teachers...'
    },
    staff: {
      title: 'Select Staff',
      icon: 'bi-people-fill',
      apiEndpoint: '/school/staff',
      placeholder: 'Search staff...'
    },
    user: {
      title: 'Select User',
      icon: 'bi-person',
      apiEndpoint: '/users',
      placeholder: 'Search user...'
    }
  };

  const endpointAliases = {
    '/accesses': 'accessProfile',
    '/chat/users/search': 'user',
    '/school/classes': 'class',
    '/school/classes/': 'class',
    '/benchpath/clb-benchmarks': 'clbBenchmark',
    '/benchpath/clb-competency-areas': 'clbCompetencyArea',
    '/benchpath/clb-competencies': 'clbCompetency',
    '/benchpath/clb-features-of-communication': 'clbFeatureOfCommunication',
    '/benchpath/clb-framework': 'clbFramework',
    '/benchpath/clb-indicators': 'clbIndicator',
    '/benchpath/clb-profile-of-ability': 'clbProfileOfAbility',
    '/benchpath/clb-sample-task-labels': 'clbSampleTaskLabel',
    '/benchpath/clb-stages': 'clbStage',
    '/benchpath/clb-skills': 'clbSkill',
    '/school/departments': 'department',
    '/school/departments/api/data': 'department',
    '/school/terms': 'term',
    '/school/transactionDefinitions': 'transactionDefinition',
    '/school/transactionTemplates': 'transactionDefinition',
    '/organizations': 'organization',
    '/operations': 'operation',
    '/persons': 'person',
    '/school/programs': 'program',
    '/school/programs/api/eligible-administrators': 'person',
    '/school/payrates/api/eligible-persons': 'person',
    '/school/timesheets/api/eligible-persons': 'person',
    '/sections': 'section',
    '/school/sessions': 'session',
    '/school/session-statuses': 'sessionStatus',
    '/users': 'user',
    '/users/': 'user',
    '/school/accounts': 'account',
    '/school/staff': 'staff',
    '/school/students': 'student',
    '/school/subjects': 'subject',
    '/school/teachers': 'teacher',
    '/help/manage/pages': 'helpPage'
    ,
    '/ielts/microAssessments': 'microAssessment',
    '/ielts/api-providers': 'ieltsApiProvider',
    '/pte/ai-assisst/api-providers': 'pteApiProvider'
  };

  function cloneContext(context) {
    if (!context || typeof context !== 'object') return context;
    return { ...context };
  }

  function buildDefaultContext(name) {
    if (!contexts || typeof contexts.activeOrganizationScope !== 'function') return null;
    const namesUsingActiveOrgContext = new Set([
      'accessProfile',
      'account',
      'class',
      'department',
      'group',
      'organization',
      'operation',
      'person',
      'program',
      'section',
      'session',
      'sessionStatus',
      'staff',
      'student',
      'subject',
      'teacher',
      'user'
    ]);
    if (!namesUsingActiveOrgContext.has(name)) return null;
    return contexts.activeOrganizationScope({ label: 'Active Organization' });
  }

  function merge(base, overrides) {
    const next = { ...(base || {}), ...(overrides || {}) };
    if (Object.prototype.hasOwnProperty.call(overrides || {}, 'context')) {
      next.context = cloneContext(overrides.context);
    } else if (base?.context) {
      next.context = cloneContext(base.context);
    }
    return next;
  }

  function stripQueryAndHash(endpoint) {
    return String(endpoint || '').trim().split('?')[0].split('#')[0];
  }

  function isSchoolPage() {
    try {
      const pathname = String(global?.location?.pathname || '').trim().toLowerCase();
      return pathname.startsWith('/school');
    } catch (_) {
      return false;
    }
  }

  function applySchoolIdentityGuardrails(name, config = {}, overrides = {}) {
    const next = { ...(config || {}) };
    if (!isSchoolPage()) return next;

    const hasExplicitEndpointOverride = Object.prototype.hasOwnProperty.call(overrides || {}, 'apiEndpoint');
    const normalizedName = String(name || '').trim().toLowerCase();
    const normalizedEndpoint = stripQueryAndHash(next.apiEndpoint).toLowerCase();

    // In school pages, do not allow person preset fallback to global /persons.
    if (normalizedName === 'person' && !hasExplicitEndpointOverride) {
      next.apiEndpoint = '/school/identity/api/persons';
      return next;
    }

    if (normalizedEndpoint === '/persons') {
      next.apiEndpoint = '/school/identity/api/persons';
    }

    return next;
  }

  function applyPickerDefaults(name, config) {
    const next = { ...(config || {}) };
    const endpoint = String(next.apiEndpoint || '').trim().toLowerCase();
    const rawLimit = Number.parseInt(String(next.limit || '').trim(), 10);
    const hasValidLimit = Number.isFinite(rawLimit) && rawLimit > 0;

    // Enable progressive loading on school pickers by default.
    if (!hasValidLimit) {
      if (endpoint.startsWith('/school/')) {
        next.limit = 20;
      } else if (String(name || '').trim().toLowerCase() === 'person') {
        // Person picker is heavily used by school forms and can be large.
        next.limit = 20;
      }
    }

    return next;
  }

  function byName(name, overrides) {
    const mergedWithGuardrails = applySchoolIdentityGuardrails(name, merge(presetMap[name] || {}, overrides), overrides);
    const merged = applyPickerDefaults(name, mergedWithGuardrails);
    if (!merged.context) {
      merged.context = buildDefaultContext(name);
    }
    return merged;
  }

  function inferName(config) {
    const endpoint = stripQueryAndHash(config?.apiEndpoint);
    if (endpoint && endpointAliases[endpoint]) return endpointAliases[endpoint];
    return null;
  }

  function normalizeConfig(config) {
    const current = { ...(config || {}) };
    const presetName = typeof current.preset === 'string' ? current.preset : inferName(current);
    if (!presetName) return current;
    delete current.preset;
    return byName(presetName, current);
  }

  const api = {
    accessProfile: (overrides) => byName('accessProfile', overrides),
    account: (overrides) => byName('account', overrides),
    class: (overrides) => byName('class', overrides),
    clbBenchmark: (overrides) => byName('clbBenchmark', overrides),
    clbCompetencyArea: (overrides) => byName('clbCompetencyArea', overrides),
    clbCompetency: (overrides) => byName('clbCompetency', overrides),
    clbFeatureOfCommunication: (overrides) => byName('clbFeatureOfCommunication', overrides),
    clbFramework: (overrides) => byName('clbFramework', overrides),
    clbIndicator: (overrides) => byName('clbIndicator', overrides),
    clbProfileOfAbility: (overrides) => byName('clbProfileOfAbility', overrides),
    clbSampleTaskLabel: (overrides) => byName('clbSampleTaskLabel', overrides),
    clbStage: (overrides) => byName('clbStage', overrides),
    clbSkill: (overrides) => byName('clbSkill', overrides),
    department: (overrides) => byName('department', overrides),
    group: (overrides) => byName('group', overrides),
    organization: (overrides) => byName('organization', overrides),
    operation: (overrides) => byName('operation', overrides),
    person: (overrides) => byName('person', overrides),
    program: (overrides) => byName('program', overrides),
    section: (overrides) => byName('section', overrides),
    session: (overrides) => byName('session', overrides),
    sessionStatus: (overrides) => byName('sessionStatus', overrides),
    staff: (overrides) => byName('staff', overrides),
    student: (overrides) => byName('student', overrides),
    subject: (overrides) => byName('subject', overrides),
    term: (overrides) => byName('term', overrides),
    teacher: (overrides) => byName('teacher', overrides),
    transactionDefinition: (overrides) => byName('transactionDefinition', overrides),
    transactionTemplate: (overrides) => byName('transactionTemplate', overrides),
    user: (overrides) => byName('user', overrides),
    helpPage: (overrides) => byName('helpPage', overrides),
    microAssessment: (overrides) => byName('microAssessment', overrides),
    ieltsApiProvider: (overrides) => byName('ieltsApiProvider', overrides),
    pteApiProvider: (overrides) => byName('pteApiProvider', overrides),
    normalizeConfig,
    contexts
  };

  global.GenericPickerPresets = api;
})(typeof window !== 'undefined' ? window : globalThis);
