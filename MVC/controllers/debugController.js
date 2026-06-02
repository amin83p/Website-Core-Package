// MVC/controllers/debugController.js
const heicConvert = require('heic-convert'); 
const dataService = require('../services/dataService');
const path = require('path');
let schoolDataService;
try {
  schoolDataService = require('../services/school/schoolDataService');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
  schoolDataService = require('../../packages/school/MVC/services/school/schoolDataService');
}
const securityService = require('../services/security');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { loadMergedProfileByIds } = require('../services/security/profileMergeService');
const { normalizeOrgRoles, getOrgRolesDisplay, getPrimaryOrgRole } = require('../utils/orgContextUtils');
const fs = require('fs');
const { randomUUID } = require('crypto');
const fileAssetStorage = require('../services/fileAssetStorageService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

// ... (Keep existing showDebugHub, showPersonUserChecker, showUserDebug, HEIC functions unchanged) ...

async function showDebugHub(req, res) {
    if (!req.user) return res.redirect('/login');
    const dashboardSections = [
        {
            priority: 10,
            title: 'Access Simulator',
            description: 'Simulate authorization checks by user, organization, and operation.',
            href: '/debug/access-debug',
            buttonLabel: 'Launch Simulator',
            icon: 'bi-shield-lock-fill',
            subtleClass: 'bg-primary-subtle text-primary',
            buttonClass: 'btn btn-primary'
        },
        {
            priority: 20,
            title: 'Access Auditor',
            description: 'Generate a full effective-permission report for a selected user.',
            href: '/debug/access-audit',
            buttonLabel: 'Open Auditor',
            icon: 'bi-file-earmark-spreadsheet-fill',
            subtleClass: '',
            iconStyle: 'background-color: #e0cffc; color: #6610f2;',
            buttonClass: 'btn',
            buttonStyle: 'background-color: #6610f2; color: white;'
        },
        {
            priority: 30,
            title: 'Integrity Auditor',
            description: 'Scan for duplicate links, orphan role records, and broken account references.',
            href: '/debug/integrity-audit',
            buttonLabel: 'Run Integrity Checks',
            icon: 'bi-clipboard2-pulse-fill',
            subtleClass: 'bg-secondary-subtle text-secondary',
            buttonClass: 'btn btn-secondary'
        },
        {
            priority: 40,
            title: 'Person-User Checker',
            description: 'Verify linkage integrity between Person records and User accounts.',
            href: '/debug/user-person-checker',
            buttonLabel: 'Check Links',
            icon: 'bi-link-45deg',
            subtleClass: 'bg-info-subtle text-info',
            buttonClass: 'btn btn-info text-white'
        },
        {
            priority: 50,
            title: 'Session Inspector',
            description: 'Inspect current req.user context and effective organization details.',
            href: '/debug/user-debug',
            buttonLabel: 'Inspect Session',
            icon: 'bi-bug-fill',
            subtleClass: 'bg-warning-subtle text-warning',
            buttonClass: 'btn btn-warning text-dark'
        },
        {
            priority: 60,
            title: 'HEIC Converter',
            description: 'Batch convert Apple HEIC image files into JPEG format.',
            href: '/debug/heic-converter',
            buttonLabel: 'Open Converter',
            icon: 'bi-images',
            subtleClass: 'bg-success-subtle text-success',
            buttonClass: 'btn btn-success'
        },
        {
            priority: 70,
            title: 'Website Policy',
            description: 'Open global governance settings, feature controls, and website policy rules.',
            href: '/websitePolicy',
            buttonLabel: 'Manage Policy',
            icon: 'bi-globe-americas',
            subtleClass: 'bg-danger-subtle text-danger',
            buttonClass: 'btn btn-danger'
        }
    ].sort((a, b) => (Number(a.priority || 0) - Number(b.priority || 0)));

    res.render('admin/debugHub', {
        title: 'Developer Tools',
        dashboardSections,
        user: req.user,
        activePage: 'tools'
    });
}

async function showPersonUserChecker(req, res) {
  try {
    if (!req.user) return res.redirect('/login');
    res.render('admin/personUserChecker', {
      title: 'Person-User Checker',
      user: req.user,
      tableName: null, print: false, btn_export: false
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load tool.', user: req.user });
  }
}

async function showIntegrityAuditor(req, res) {
  try {
    if (!req.user) return res.redirect('/login');
    res.render('admin/integrityAuditor', {
      title: 'Data Integrity Auditor',
      user: req.user,
      activePage: 'tools'
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load integrity auditor.', user: req.user });
  }
}


function pushIssue(collection, issue) {
  collection.push({
    severity: issue.severity || 'warning',
    type: issue.type || 'general',
    entity: issue.entity || '',
    recordId: issue.recordId || '',
    personId: issue.personId || '',
    orgId: issue.orgId || '',
    message: issue.message || ''
  });
}

function addDuplicateRoleIssues(records, issues, entityType, roleName) {
  const map = new Map();
  for (const record of records || []) {
    const key = `${String(record?.orgId || '')}::${String(record?.personId || '')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  for (const [key, matches] of map.entries()) {
    if (matches.length <= 1) continue;
    const [orgId, personId] = key.split('::');
    pushIssue(issues, {
      severity: 'error',
      type: `duplicate_${entityType}`,
      entity: entityType,
      personId,
      orgId,
      recordId: matches.map((m) => m.id).join(', '),
      message: `Multiple ${roleName} records exist for the same person in the same organization.`
    });
  }
}

function auditRoleRecords(records, personsById, accountsById, roleName, entityType, accountField, issues) {
  for (const record of records || []) {
    const personId = String(record?.personId || '').trim();
    const orgId = String(record?.orgId || '').trim();
    const accountId = String(record?.[accountField] || '').trim();
    const person = personsById.get(personId);

    if (!person) {
      pushIssue(issues, {
        severity: 'error',
        type: `missing_person_${entityType}`,
        entity: entityType,
        recordId: record?.id,
        personId,
        orgId,
        message: `${roleName} record references a missing person.`
      });
      continue;
    }

    const orgMembership = Array.isArray(person.organizations)
      ? person.organizations.find((org) => String(org?.orgId || '') === orgId)
      : null;

    if (!orgMembership) {
      pushIssue(issues, {
        severity: 'error',
        type: `missing_org_membership_${entityType}`,
        entity: entityType,
        recordId: record?.id,
        personId,
        orgId,
        message: `${roleName} record exists, but the linked person has no membership in that organization.`
      });
    } else {
      const roles = normalizeOrgRoles(orgMembership);
      if (!roles.includes(roleName.toLowerCase())) {
        pushIssue(issues, {
          severity: 'warning',
          type: `missing_role_${entityType}`,
          entity: entityType,
          recordId: record?.id,
          personId,
          orgId,
          message: `${roleName} record exists, but the linked person is missing the '${roleName.toLowerCase()}' org role.`
        });
      }
    }

    if (accountId) {
      const account = accountsById.get(accountId);
      if (!account) {
        pushIssue(issues, {
          severity: 'error',
          type: `missing_account_${entityType}`,
          entity: entityType,
          recordId: record?.id,
          personId,
          orgId,
          message: `${roleName} record points to a missing linked account (${accountId}).`
        });
      } else if (String(account.partyRole || '').toLowerCase() !== roleName.toLowerCase()) {
        pushIssue(issues, {
          severity: 'warning',
          type: `account_role_mismatch_${entityType}`,
          entity: entityType,
          recordId: record?.id,
          personId,
          orgId,
          message: `${roleName} record is linked to account ${accountId}, but the account party role is '${account.partyRole || 'none'}'.`
        });
      }
    }
  }
}

async function runIntegrityAudit(req, res) {
  try {
    const [persons, users, students, teachers, staff, schoolAccounts] = await Promise.all([
      dataService.fetchData('persons', {}, SYSTEM_CONTEXT, PERSON_QUERY_OPTIONS),
      dataService.fetchData('users', {}, SYSTEM_CONTEXT),
      schoolDataService.fetchData('students', {}, null),
      schoolDataService.fetchData('teachers', {}, null),
      schoolDataService.fetchData('staff', {}, null),
      schoolDataService.fetchData('schoolAccounts', {}, null)
    ]);

    const issues = [];
    const personsById = new Map((persons || []).map((person) => [String(person.id), person]));
    const accountsById = new Map((schoolAccounts || []).map((account) => [String(account.id), account]));

    const userLinks = new Map();
    for (const user of users || []) {
      const personId = String(user?.personId || '').trim();
      if (!personId || String(personId) === 'NO_PERSONID') continue;
      if (!userLinks.has(personId)) userLinks.set(personId, []);
      userLinks.get(personId).push(user);

      if (!personsById.has(personId)) {
        pushIssue(issues, {
          severity: 'error',
          type: 'user_missing_person',
          entity: 'users',
          recordId: user?.id,
          personId,
          message: 'User is linked to a person that does not exist.'
        });
      }

      const orgMemberships = Array.isArray(user?.organizations) ? user.organizations : [];
      const seenOrgIds = new Set();
      for (const org of orgMemberships) {
        const orgId = String(org?.orgId || '').trim();
        if (!orgId) continue;
        if (seenOrgIds.has(orgId)) {
          pushIssue(issues, {
            severity: 'warning',
            type: 'duplicate_user_org_membership',
            entity: 'users',
            recordId: user?.id,
            personId,
            orgId,
            message: 'User contains duplicate organization membership entries.'
          });
        }
        seenOrgIds.add(orgId);
      }
    }

    for (const [personId, linkedUsers] of userLinks.entries()) {
      if (linkedUsers.length > 1) {
        pushIssue(issues, {
          severity: 'error',
          type: 'duplicate_user_link',
          entity: 'users',
          personId,
          recordId: linkedUsers.map((user) => user.id).join(', '),
          message: 'More than one user account is linked to the same person.'
        });
      }
    }

    for (const person of persons || []) {
      const orgMemberships = Array.isArray(person?.organizations) ? person.organizations : [];
      const seenOrgIds = new Set();
      for (const org of orgMemberships) {
        const orgId = String(org?.orgId || '').trim();
        if (!orgId) continue;
        if (seenOrgIds.has(orgId)) {
          pushIssue(issues, {
            severity: 'warning',
            type: 'duplicate_person_org_membership',
            entity: 'persons',
            recordId: person?.id,
            personId: person?.id,
            orgId,
            message: 'Person contains duplicate organization membership entries.'
          });
        }
        seenOrgIds.add(orgId);
      }
    }

    addDuplicateRoleIssues(students, issues, 'students', 'student');
    addDuplicateRoleIssues(teachers, issues, 'teachers', 'teacher');
    addDuplicateRoleIssues(staff, issues, 'staff', 'staff');

    auditRoleRecords(students, personsById, accountsById, 'student', 'students', 'studentAccountId', issues);
    auditRoleRecords(teachers, personsById, accountsById, 'teacher', 'teachers', 'teacherAccountId', issues);
    auditRoleRecords(staff, personsById, accountsById, 'staff', 'staff', 'staffAccountId', issues);

    const summary = {
      totalIssues: issues.length,
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      checked: {
        persons: (persons || []).length,
        users: (users || []).length,
        students: (students || []).length,
        teachers: (teachers || []).length,
        staff: (staff || []).length,
        schoolAccounts: (schoolAccounts || []).length
      }
    };

    res.json({ status: 'success', summary, issues });
  } catch (error) {
    console.error('Integrity Audit Error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function showUserDebug(req, res) {
  if (!req.user) return res.redirect('/login');
  const sessionUser = req.user || {};
  let storedUser = null;
  try {
    storedUser = sessionUser.id ? await dataService.getDataById('users', sessionUser.id, sessionUser) : null;
  } catch (error) {
    console.log('[debug][warn] Failed to load persisted user for session inspector:', error.message);
  }
  const user = {
    ...sessionUser,
    ...(storedUser && typeof storedUser === 'object' ? storedUser : {}),
    organizations: Array.isArray(storedUser?.organizations)
      ? storedUser.organizations
      : (Array.isArray(sessionUser.organizations) ? sessionUser.organizations : []),
    audit: storedUser?.audit || sessionUser.audit || null
  };
  res.render('admin/userDebug', { title: 'User Debug Info', user, includeModal: false });
}

async function showHeicConverter(req, res){
    res.render('admin/heicConverter', { title: 'HEIC Converter', user: req.user, activePage: 'tools', path: '/tools/heic-converter' });
}

async function processHeicConversion_RAM(req, res){
    // ... (Keep existing implementation) ...
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ status: 'error', message: 'No files uploaded.' });
        const convertedFiles = [];
        for (const file of req.files) {
            try {
                const jpgBuffer = await heicConvert({ buffer: file.buffer, format: 'JPEG', quality: 0.90 });
                convertedFiles.push({
                    originalName: file.originalname,
                    name: file.originalname.replace(/\.heic$/i, '.jpg').replace(/\.HEIC$/i, '.jpg'),
                    data: `data:image/jpeg;base64,${Buffer.from(jpgBuffer).toString('base64')}`
                });
            } catch (err) {
                convertedFiles.push({ originalName: file.originalname, error: true, message: "Corrupt or unsupported file" });
            }
        }
        res.json({ status: 'success', files: convertedFiles });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Server error during conversion.' });
    }
}

async function processHeicConversion_HDD(req, res){
    // ... (Keep existing implementation) ...
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ status: 'error', message: 'No files uploaded.' });
        const convertedFiles = [];
        const dateFolder = new Date().toISOString().slice(0, 10);
        const jobId = randomUUID();
        const relativeDir = uploadFolderSettingsService.resolveUploadFolder('generated.heic', {
            jobDate: dateFolder,
            jobId
        });
        for (const file of req.files) {
            try {
                const inputBuffer = file.buffer || await fs.promises.readFile(file.path);
                const originalAsset = await fileAssetStorage.saveBuffer({
                    scopeKey: 'GLOBAL',
                    relativeDir,
                    fileName: file.originalname,
                    originalName: file.originalname,
                    mimeType: file.mimetype || 'image/heic',
                    buffer: inputBuffer
                });
                const jpgBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.8 });
                const jpgName = file.originalname.replace(/\.(heic|heif)$/i, '.jpg');
                const convertedAsset = await fileAssetStorage.saveBuffer({
                    scopeKey: 'GLOBAL',
                    relativeDir,
                    fileName: jpgName,
                    originalName: jpgName,
                    mimeType: 'image/jpeg',
                    buffer: Buffer.from(jpgBuffer)
                });
                convertedFiles.push({
                    originalName: file.originalname,
                    name: convertedAsset.fileName || jpgName,
                    originalUrl: originalAsset.url,
                    url: convertedAsset.url,
                    data: `data:image/jpeg;base64,${Buffer.from(jpgBuffer).toString('base64')}`
                });
            } catch (err) {
                convertedFiles.push({ originalName: file.originalname, error: true, message: "Corrupt or unsupported file" });
            }
        }
        res.json({ status: 'success', files: convertedFiles });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Server error during conversion.' });
    }
}

// ... (Keep Access Debugger functions) ...
async function showAccessDebugger(req, res) {
    if (!req.user) return res.redirect('/login');
    res.render('admin/accessDebugger', { title: 'Access Debugger', user: req.user, activePage: 'tools', path: '/debug/access-debug' });
}

async function runAccessSimulation(req, res) {
    try {
        const { userId, orgId, sectionId, operationId, ipAddress } = req.body;
        const targetUser = await dataService.getDataById('users', userId, req.user);
        if (!targetUser) throw new Error("User not found");

        const policies = await dataService.fetchData('accessPolicies', { q: targetUser.id, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT);
        if (policies.length > 0) targetUser.activePolicy = policies[0];

        const activeOrgId = orgId || targetUser.primaryOrgId;
        
        // 1. Virtual Admin
        if (targetUser.isVirtualSuperAdmin) {
             targetUser.activeProfile = { name: 'SYSTEM_ROOT', fullAdmin: true };
        } 
        // 2. System Admin (Tier 2)
        else if (targetUser.systemAccessProfileId) {
             // System Admins carry their profile everywhere
             targetUser.activeProfile = await dataService.getDataById('accesses', targetUser.systemAccessProfileId, SYSTEM_CONTEXT);
             targetUser.isSystemAdmin = true; 
        }
        // 3. Org Member
        else if (activeOrgId) {
             const orgConf = (targetUser.organizations || []).find(o => Number(o.orgId) === Number(activeOrgId));
             if (orgConf) {
                 if (orgConf.memberStatus !== 'active') {
                     targetUser.activeProfile = null;
                 } else if (orgConf.accessProfileIds && orgConf.accessProfileIds.length > 0) {
                     targetUser.activeProfile = await loadMergedProfileByIds(orgConf.accessProfileIds, SYSTEM_CONTEXT);
                 }
             }
        }
        
        const result = await securityService.evaluateAccess({ user: targetUser, sectionId, operationId, ipAddress });
        res.json({ status: 'success', result });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
}

async function showUserAccessAuditor(req, res) {
    if (!req.user) return res.redirect('/login');
    res.render('admin/userAccessAuditor', { title: 'User Access Auditor', user: req.user, activePage: 'tools' });
}

// ✅ FIXED: Report Generator for System/Virtual Admins
async function runUserAccessAudit(req, res) {
    try {
        const { userId } = req.body;
        const targetUser = await dataService.getDataById('users', userId, req.user);
        if (!targetUser) throw new Error("User not found");

        // 1. FETCH DEFINITIONS
        const [allSections, allOps, policies] = await Promise.all([
            dataService.fetchData('sections', {}, SYSTEM_CONTEXT),
            dataService.fetchData('operations', {}, SYSTEM_CONTEXT),
            dataService.fetchData('accessPolicies', { q: targetUser.id, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT)
        ]);

        const secMap = new Map(allSections.map(s => [s.id, s.name]));
        const opMap = new Map(allOps.map(o => [o.id, o.name]));
        const policy = policies[0] || null;

        const report = [];
        
        // ✅ NEW: Build List of Contexts to Audit
        // Instead of just targetUser.organizations, we construct a list including Global scopes
        let contextsToAudit = [];

        // A. Virtual Super Admin Context
        if (targetUser.isVirtualSuperAdmin) {
            contextsToAudit.push({
                orgId: 'ROOT',
                name: 'Virtual System Root',
                roles: ['super_admin'],
                role: 'Super Admin',
                memberStatus: 'active',
                accessProfileIds: [], // Virtual privileges don't need a profile ID
                isVirtualRoot: true
            });
        }

        // B. System Admin Context (Tier 2)
        if (targetUser.systemAccessProfileId) {
            contextsToAudit.push({
                orgId: 'GLOBAL',
                name: 'System-Wide Global Access',
                roles: ['system_user'],
                role: 'System User',
                memberStatus: 'active',
                accessProfileIds: [targetUser.systemAccessProfileId], // Apply Global Profile
                isSystemGlobal: true
            });
        }

        // C. Standard Organizations
        if (targetUser.organizations && Array.isArray(targetUser.organizations)) {
            contextsToAudit = contextsToAudit.concat(targetUser.organizations);
        }

        // 2. ITERATE CONTEXTS
        for (const orgConf of contextsToAudit) {
            
            const orgReport = {
                orgId: orgConf.orgId,
                orgName: orgConf.name,
                roles: normalizeOrgRoles(orgConf),
                role: getPrimaryOrgRole(orgConf),
                roleDisplay: getOrgRolesDisplay(orgConf),
                status: orgConf.memberStatus,
                profileIds: orgConf.accessProfileIds || [],
                profileNames: [],
                policyName: policy ? policy.policyName : null,
                effectivePermissions: {
                    isFullAdmin: false,
                    isGlobalBan: false,
                    sections: {} 
                }
            };

            // --- Status Checks ---
            if (orgConf.memberStatus !== 'active') {
                orgReport.status = 'SUSPENDED (Org Status)';
                report.push(orgReport);
                continue;
            }
            
            // --- Virtual Root Logic ---
            if (orgConf.isVirtualRoot) {
                orgReport.effectivePermissions.isFullAdmin = true;
                report.push(orgReport);
                continue;
            }

            // --- Policy Ban Check ---
            if (policy && policy.active === false) {
                orgReport.effectivePermissions.isGlobalBan = true;
                orgReport.status = 'BLOCKED (Policy Inactive)';
                report.push(orgReport);
                continue;
            }

            // --- Profile Merge Logic ---
            if (orgReport.profileIds.length > 0) {
                for (const pid of orgReport.profileIds) {
                    const profile = await dataService.getDataById('accesses', pid, SYSTEM_CONTEXT);
                    if (!profile) continue;
                    orgReport.profileNames.push(profile.name);

                    if (profile.fullAdmin) {
                        orgReport.effectivePermissions.isFullAdmin = true;
                        break; 
                    }

                    if (profile.sections) {
                        profile.sections.forEach(sec => {
                            const sid = sec.sectionId;
                            if (!orgReport.effectivePermissions.sections[sid]) {
                                orgReport.effectivePermissions.sections[sid] = { 
                                    adminAccess: false, operations: [], source: 'profile' 
                                };
                            }
                            if (sec.adminAccess) orgReport.effectivePermissions.sections[sid].adminAccess = true;
                            if (sec.operations) {
                                sec.operations.forEach(op => {
                                    if (!orgReport.effectivePermissions.sections[sid].operations.includes(op.operationId)) {
                                        orgReport.effectivePermissions.sections[sid].operations.push(op.operationId);
                                    }
                                });
                            }
                        });
                    }
                }
            }

            // --- Policy Overlay Logic ---
            if (policy && policy.sections) {
                policy.sections.forEach(pSec => {
                    const sid = pSec.sectionId;
                    
                    if (pSec.accessState?.status === 'suspended' || pSec.accessType === 'full_ban') {
                        if (orgReport.effectivePermissions.sections[sid]) {
                            orgReport.effectivePermissions.sections[sid].policyStatus = 'BANNED';
                            orgReport.effectivePermissions.sections[sid].operations = []; 
                            orgReport.effectivePermissions.sections[sid].adminAccess = false;
                        }
                        return;
                    }

                    if (pSec.accessType === 'full_access') {
                        if (!orgReport.effectivePermissions.sections[sid]) {
                            orgReport.effectivePermissions.sections[sid] = { operations: [], source: 'policy' };
                        }
                        orgReport.effectivePermissions.sections[sid].adminAccess = true;
                        orgReport.effectivePermissions.sections[sid].policyStatus = 'GRANTED';
                    }

                    if (pSec.operations) {
                        pSec.operations.forEach(pOp => {
                            if (!orgReport.effectivePermissions.sections[sid]) {
                                orgReport.effectivePermissions.sections[sid] = { adminAccess: false, operations: [], source: 'policy' };
                            }
                            const secRef = orgReport.effectivePermissions.sections[sid];

                            if (pOp.accessType === 'full_ban') {
                                secRef.operations = secRef.operations.filter(op => op !== pOp.operationId);
                                if(!secRef.bannedOps) secRef.bannedOps = [];
                                secRef.bannedOps.push(pOp.operationId);
                            } else {
                                if (!secRef.operations.includes(pOp.operationId) && !secRef.adminAccess) {
                                    secRef.operations.push(pOp.operationId);
                                    if(!secRef.policyGrantedOps) secRef.policyGrantedOps = [];
                                    secRef.policyGrantedOps.push(pOp.operationId);
                                }
                            }
                        });
                    }
                });
            }

            // --- Enrichment (Name Resolution) ---
            for (const [sid, secData] of Object.entries(orgReport.effectivePermissions.sections)) {
                secData.sectionName = secMap.get(sid) || sid;
                secData.operations = secData.operations.map(opId => ({
                    id: opId,
                    name: opMap.get(opId) || opId
                }));
                if (secData.bannedOps) {
                    secData.bannedOps = secData.bannedOps.map(opId => ({
                        id: opId,
                        name: opMap.get(opId) || opId
                    }));
                }
            }

            report.push(orgReport);
        }

        res.json({ status: 'success', report });

    } catch (error) {
        console.error("Audit Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
}

module.exports = { 
    showDebugHub,
    showPersonUserChecker, 
    showIntegrityAuditor,
    processHeicConversion_HDD, 
    processHeicConversion_RAM, 
    showHeicConverter,
    showUserDebug,
    showAccessDebugger,
    runAccessSimulation,
    showUserAccessAuditor,
    runUserAccessAudit,
    runIntegrityAudit
};
