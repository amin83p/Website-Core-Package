// config/constants.js
const path = require('path');

const SYSTEM_CONTEXT = Symbol('SYSTEM_CONTEXT'); // Unique value that cannot be faked via JSON

module.exports = {
  // ============================================================
  // INTERNAL CONSTANTS (Do not change via Admin Panel)
  // ============================================================
  SYSTEM_CONTEXT,

  // ============================================================
  // FACTORY DEFAULTS
  // These are used by the System Settings Model as fallbacks
  // if the systemSettings.json file is missing or corrupted.
  // ============================================================
  DEFAULTS: {
      // App
      UPLOADS_PATH: 'uploads', // Relative path recommended
      DEFAULT_PAGE_SIZE: 20,
      SEARCH_DEFAULT_KEYWORD: 'aaa',
      SCHOOL_CANONICAL_ENROLLMENT_READ: false,
      SCHOOL_CANONICAL_ENROLLMENT_WRITE: false,
      SCHOOL_INTENTIONAL_CONFLICT_MODE: false,
      SCHOOL_READ_MODELS_ENABLED: false,
      SCHOOL_ENABLE_ROLLING_CLASS_WORKFLOW: true,
      SCHOOL_ROLLING_WORKFLOW_PILOT_ORG_IDS: '',
      SCHOOL_ROLLING_WORKFLOW_PILOT_PROGRAM_IDS: '',

      // Access
      HIGH_ACCESS_MIN: 8,
      HIGH_ACCESS_MAX: 10,
      SELF_ACCESS_LEVEL: 1,
      IMMUNE_SUPER_ADMINS: [
        'admin@localhost.com', 
        'root@system.local'
      ],

      // Organization
      FREE_ORG_ID: 900000,
      FREE_ORG_NAME: 'Free User',
      
      // Newsletter
      NEWSLETTER_DEFAULT_GROUP: '',
      NEWSLETTER_DOUBLE_OPT_IN: false,
      NEWSLETTER_WELCOME_EMAIL: true
  },
  SECTION_KEYS: {
    IELTS: 'IELTS',
    IELTS_API_PROVIDERS: 'IELTS_API_PROVIDERS',
    IELTS_AI_TOKEN_USAGE: 'IELTS_AI_TOKEN_USAGE'
  }
};
