// config/accessConstants.js

/* ============================================================
   SECTION IDENTIFIERS
   (Used in Routes and Database "sectionId")
============================================================ */
const SECTIONS = {
    USERS: 'USERS',
    PERSONS: 'PERSONS',
    ORGANIZATIONS: 'ORGANIZATIONS',
    OPERATIONS: 'OPERATIONS',
    ROLES: 'ROLES',
    SECTIONS: 'SECTIONS',
    SCOPES: 'SCOPES',
    ACCESS_PROFILES: 'ACCESS_PROFILES', 
    ACCESS_POLICIES: 'ACCESS_POLICIES',
    LOGS: 'LOGS',
    TABLE_SETTINGS: 'TABLE_SETTINGS',
    DASHBOARD: 'DASHBOARD',
    ACTION_STATES: 'ACTION_STATES',
    TRACK_ACTIVITY: 'TRACK_ACTIVITY',
    ORGANIZATION_POLICIES: 'ORGANIZATION_POLICIES',
    SYMBOLS: 'SYMBOLS',
    UPLOADED_FILES: 'UPLOADED_FILES',
    TASKS: 'TASKS',
    CONTACT_MESSAGES: 'CONTACT_MESSAGES',
    NEWSLETTERS: 'NEWSLETTERS',
    SUBSCRIPTION_GROUPS: 'SUBSCRIPTION_GROUPS',
    CHATS: 'CHATS',
    USER_MEMBERSHIPS: 'USER_MEMBERSHIPS',
    HELP: 'HELP',
    SYSTEM_SETTINGS: 'SYSTEM_SETTINGS',
    SYSTEM_PACKAGE_MANAGER: 'SYSTEM_PACKAGE_MANAGER',
    SYSTEM_PACKAGE_BUILDER: 'SYSTEM_PACKAGE_BUILDER',
    SYSTEM_CORE_RESET: 'SYSTEM_CORE_RESET',
    SYSTEM_UPLOAD_FOLDERS: 'SYSTEM_UPLOAD_FOLDERS',
    WEBSITE_POLICY: 'WEBSITE_POLICY',
    DEBUG_HUB: 'DEBUG_HUB',
    DEBUG_ACCESS_SIMULATOR: 'DEBUG_ACCESS_SIMULATOR',
    DEBUG_ACCESS_AUDITOR: 'DEBUG_ACCESS_AUDITOR',
    DEBUG_INTEGRITY_AUDITOR: 'DEBUG_INTEGRITY_AUDITOR',
    DEBUG_USER_PERSON_CHECKER: 'DEBUG_USER_PERSON_CHECKER',
    DEBUG_USER_SESSION_INSPECTOR: 'DEBUG_USER_SESSION_INSPECTOR',
    DEBUG_HEIC_CONVERTER: 'DEBUG_HEIC_CONVERTER',
    EMAIL_MANAGEMENT: 'EMAIL_MANAGEMENT',
    EMAIL_TEMPLATES: 'EMAIL_TEMPLATES',
    EMAIL_LEDGER: 'EMAIL_LEDGER'
    
};

/* ============================================================
   GENERIC OPERATION IDENTIFIERS
   (Reused across all sections)
============================================================ */
const OPERATIONS = {
    // Standard CRUD
    READ: 'READ',      // View list or details
    READ_ALL: 'READ_ALL',      // View list or details
    CREATE: 'CREATE',  // Add new item
    UPDATE: 'UPDATE',  // Edit existing item
    CONFIGURE: 'CONFIGURE', // Configure settings/state
    DELETE: 'DELETE',  // Remove item
    DELETE_ALL: 'DELETE_ALL',  // Remove item

    // Extended Actions
    START: 'START', // Start a process/session
    SAVE: 'SAVE', // Save progress/state
    EXPORT: 'EXPORT',  // Export data (CSV/JSON)
    IMPORT: 'IMPORT',  // Bulk import
    DOWNLOAD_FILE: 'DOWNLOAD_FILE',
    DELETE_FILE: 'DELETE_FILE',
    AI_SCORING: 'AI_SCORING', // Run AI scoring/feedback workflows
    // Specific / Utility
    UNLINK: 'UNLINK',  // e.g. Unlink User from Person
    CLEAR_ALL: 'CLEAR_ALL', // e.g. Clear all logs
    VIEW_DASHBOARD: 'VIEW_DASHBOARD',
    //Operation to check if a personID linked to a user account.
    USERS_CHECK_LINKEDPERSON: 'USERS_CHECK_LINKEDPERSON',
    LOGS: 'LOGS'
};

module.exports = {
    SECTIONS,
    OPERATIONS
};
