// MVC/models/websitePolicyModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');

const dataPath = path.join(__dirname, '../../data/websitePolicy.json');

const defaults = {
    // --- SPECIAL WEBSITE FEATURES ---
    maintenance: {
        enabled: false,
        message: "System Maintenance in progress. Please check back later.",
        allowedRoles: ["super_admin", "developer"],
        allowedIps: []
    },
    features: {
        registration: true,
        apiAccess: true,
        publicAccess: true, 
        backgroundJobs: true
    },
    
    // ✅ NEW: Global Session Control
    sessionControl: {
        maxSessions: 10,        // Max active devices per user
        maxDuration: 720,       // 12 Hours (Hard Limit)
        idleTimeout: 60         // 1 Hour (Inactivity Limit)
    },
    // ✅ NEW: Request Rate Control (Phase 1: Monitor)
    requestControl: {
        enabled: true,
        mode: 'monitor', // monitor | enforce
        logCooldownMs: 60000,
        excludePaths: ['/health', '/favicon.ico'],
        phase2: {
            enabled: false,
            enforceGroups: ['auth', 'heavy']
        },
        phase3: {
            enabled: true
        },
        routeCatalog: {
            disabledRouteIds: [],
            groupOverrides: {},
            routeSettings: {}
        },
        routeOverrides: [],
        groups: {
            auth: { windowMs: 900000, max: 30, keyMode: 'username_ip' },
            picker: { windowMs: 60000, max: 120, keyMode: 'user_or_ip' },
            write: { windowMs: 60000, max: 80, keyMode: 'user_or_ip' },
            heavy: { windowMs: 600000, max: 20, keyMode: 'user_or_ip' },
            global: { windowMs: 60000, max: 300, keyMode: 'user_or_ip' }
        }
    },

    // --- STANDARD POLICY FEATURES ---
    network: { ipWhitelist: [], ipBlacklist: [] },
    globalSchedule: { weekdays: {} },
    sections: [], 
    bannedUsers: [], 
    
    audit: { lastUpdateUser: "SYSTEM", lastUpdateDateTime: new Date().toISOString() }
};

/* ============================================================
   READ OPERATIONS
============================================================ */
async function getPolicy() {
    try {
        await fs.access(dataPath);
        const data = await fs.readFile(dataPath, 'utf8');
        const parsed = JSON.parse(data);
        return {
            ...defaults,
            ...parsed,
            maintenance: { ...defaults.maintenance, ...(parsed.maintenance || {}) },
            features: { ...defaults.features, ...(parsed.features || {}) },
            sessionControl: { ...defaults.sessionControl, ...(parsed.sessionControl || {}) },
            requestControl: {
                ...defaults.requestControl,
                ...(parsed.requestControl || {}),
                phase2: {
                    ...defaults.requestControl.phase2,
                    ...((parsed.requestControl || {}).phase2 || {})
                },
                phase3: {
                    ...defaults.requestControl.phase3,
                    ...((parsed.requestControl || {}).phase3 || {})
                },
                routeCatalog: {
                    ...defaults.requestControl.routeCatalog,
                    ...((parsed.requestControl || {}).routeCatalog || {}),
                    disabledRouteIds: Array.isArray(((parsed.requestControl || {}).routeCatalog || {}).disabledRouteIds)
                        ? ((parsed.requestControl || {}).routeCatalog || {}).disabledRouteIds
                        : defaults.requestControl.routeCatalog.disabledRouteIds,
                    groupOverrides: (((parsed.requestControl || {}).routeCatalog || {}).groupOverrides && typeof ((parsed.requestControl || {}).routeCatalog || {}).groupOverrides === 'object')
                        ? ((parsed.requestControl || {}).routeCatalog || {}).groupOverrides
                        : defaults.requestControl.routeCatalog.groupOverrides,
                    routeSettings: (((parsed.requestControl || {}).routeCatalog || {}).routeSettings && typeof ((parsed.requestControl || {}).routeCatalog || {}).routeSettings === 'object')
                        ? ((parsed.requestControl || {}).routeCatalog || {}).routeSettings
                        : defaults.requestControl.routeCatalog.routeSettings
                },
                routeOverrides: Array.isArray((parsed.requestControl || {}).routeOverrides)
                    ? (parsed.requestControl || {}).routeOverrides
                    : defaults.requestControl.routeOverrides,
                groups: {
                    ...defaults.requestControl.groups,
                    ...((parsed.requestControl || {}).groups || {}),
                    auth: { ...defaults.requestControl.groups.auth, ...(((parsed.requestControl || {}).groups || {}).auth || {}) },
                    picker: { ...defaults.requestControl.groups.picker, ...(((parsed.requestControl || {}).groups || {}).picker || {}) },
                    write: { ...defaults.requestControl.groups.write, ...(((parsed.requestControl || {}).groups || {}).write || {}) },
                    heavy: { ...defaults.requestControl.groups.heavy, ...(((parsed.requestControl || {}).groups || {}).heavy || {}) },
                    global: { ...defaults.requestControl.groups.global, ...(((parsed.requestControl || {}).groups || {}).global || {}) }
                }
            },
            network: { ...defaults.network, ...(parsed.network || {}) },
            globalSchedule: { ...defaults.globalSchedule, ...(parsed.globalSchedule || {}) },
            sections: parsed.sections ?? defaults.sections,
            bannedUsers: parsed.bannedUsers ?? defaults.bannedUsers
        };
    } catch {
        await fs.writeFile(dataPath, JSON.stringify(defaults, null, 2));
        return defaults;
    }
}

/* ============================================================
   WRITE OPERATIONS
============================================================ */
async function updatePolicy(updates, user) {
    return await queueWrite(async () => {
        const current = await getPolicy();
        
        // Deep merge top-level objects to preserve structure
        const merged = {
            ...current,
            ...updates,
            
            // Merge Nested Objects
            maintenance: { ...current.maintenance, ...(updates.maintenance || {}) },
            features: { ...current.features, ...(updates.features || {}) },
            
            // ✅ Merge Session Control
            sessionControl: { ...current.sessionControl, ...(updates.sessionControl || {}) },
            // ✅ Merge Request Control
            requestControl: {
                ...current.requestControl,
                ...(updates.requestControl || {}),
                phase2: {
                    ...(current.requestControl?.phase2 || {}),
                    ...((updates.requestControl || {}).phase2 || {})
                },
                phase3: {
                    ...(current.requestControl?.phase3 || {}),
                    ...((updates.requestControl || {}).phase3 || {})
                },
                routeCatalog: {
                    ...(current.requestControl?.routeCatalog || {}),
                    ...((updates.requestControl || {}).routeCatalog || {}),
                    disabledRouteIds: Array.isArray(((updates.requestControl || {}).routeCatalog || {}).disabledRouteIds)
                        ? ((updates.requestControl || {}).routeCatalog || {}).disabledRouteIds
                        : (current.requestControl?.routeCatalog?.disabledRouteIds || []),
                    groupOverrides: (((updates.requestControl || {}).routeCatalog || {}).groupOverrides && typeof ((updates.requestControl || {}).routeCatalog || {}).groupOverrides === 'object')
                        ? ((updates.requestControl || {}).routeCatalog || {}).groupOverrides
                        : (current.requestControl?.routeCatalog?.groupOverrides || {}),
                    routeSettings: (((updates.requestControl || {}).routeCatalog || {}).routeSettings && typeof ((updates.requestControl || {}).routeCatalog || {}).routeSettings === 'object')
                        ? ((updates.requestControl || {}).routeCatalog || {}).routeSettings
                        : (current.requestControl?.routeCatalog?.routeSettings || {})
                },
                routeOverrides: Array.isArray((updates.requestControl || {}).routeOverrides)
                    ? (updates.requestControl || {}).routeOverrides
                    : (current.requestControl?.routeOverrides || []),
                groups: {
                    ...(current.requestControl?.groups || {}),
                    ...((updates.requestControl || {}).groups || {}),
                    auth: { ...(current.requestControl?.groups?.auth || {}), ...(((updates.requestControl || {}).groups || {}).auth || {}) },
                    picker: { ...(current.requestControl?.groups?.picker || {}), ...(((updates.requestControl || {}).groups || {}).picker || {}) },
                    write: { ...(current.requestControl?.groups?.write || {}), ...(((updates.requestControl || {}).groups || {}).write || {}) },
                    heavy: { ...(current.requestControl?.groups?.heavy || {}), ...(((updates.requestControl || {}).groups || {}).heavy || {}) },
                    global: { ...(current.requestControl?.groups?.global || {}), ...(((updates.requestControl || {}).groups || {}).global || {}) }
                }
            },

            network: { ...current.network, ...(updates.network || {}) },
            globalSchedule: { ...current.globalSchedule, ...(updates.globalSchedule || {}) },
            
            // Replace Arrays
            sections: updates.sections ?? current.sections,
            bannedUsers: updates.bannedUsers ?? current.bannedUsers,
            
            audit: {
                lastUpdateUser: user ? (user.username || user.id) : 'SYSTEM',
                lastUpdateDateTime: new Date().toISOString()
            }
        };

        await fs.writeFile(dataPath, JSON.stringify(merged, null, 2));
        return merged;
    });
}

module.exports = { getPolicy, updatePolicy };
