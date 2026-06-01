// MVC/models/systemSettingsModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue'); 
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');

const settingsPath = path.join(__dirname, '../../data/systemSettings.json');

const DEFAULT_APP_BRAND = {
  appName: 'Amin Paknejad',
  appShortName: 'Website',
  tagline: 'Learn, work, and thrive in new places.',
  logoUrl: '/uploads/GLOBAL/logo/Logo1.png',
  iconSvgUrl: '/uploads/GLOBAL/logo/icon.svg',
  appleTouchIconUrl: '/uploads/GLOBAL/logo/Logo1.png',
  themeColor: '#ffffff',
  ownerDisplayName: 'Amin Paknejad',
  footerAboutTitle: 'About Amin Paknejad',
  footerAboutText: 'Amin Paknejad, PhD, is a Calgary-based engineer, software developer, and instructor. His work focuses on CFD, scientific computing, and building practical tools that make research and engineering workflows faster and more reliable.',
  footerLogoAlt: 'Amin Paknejad',
  footerShowNewsletter: true,
  instagramUrl: '',
  facebookUrl: '',
  linkedinUrl: '',
  youtubeUrl: ''
};

const DEFAULT_APP_CONTACT = {
  email: 'paknejad@live.com',
  collegeEmail: '',
  phone: '+1 (437) 602-8720',
  address: 'Calgary, Alberta',
  faxes: []
};

const DEFAULT_APP_CONTACT_PAGE = {
  heroEyebrow: 'Contact And Support',
  heroTitle: 'Tell us what you need next.',
  heroSubtitle: 'Send a message and we will reply with a recommended approach, timeline, and the details needed to move the work forward.',
  primaryCtaLabel: 'Go To Form',
  emailCtaLabel: 'Email Directly',
  followUpCtaLabel: 'Follow Up',
  highlights: [
    { title: 'Clear Context', body: 'Share goals, files, links, and constraints in one place.' },
    { title: 'Follow-Up Code', body: 'Track your submitted message later with your private code.' },
    { title: 'Direct Route', body: 'Use email if your request is urgent or already documented.' }
  ],
  formEyebrow: 'Message Details',
  formTitle: 'Project / inquiry form',
  formSubtitle: 'Share enough context for a useful first reply.',
  formHint: 'Tip: If you include links, screenshots, or a short description of the decision you need to make, I can respond faster.',
  directContactKicker: 'Reach Us',
  directContactTitle: 'Direct Contact',
  directContactLead: 'Choose the route that fits your request best. Email is usually the clearest option for detailed project context.',
  directContactMethodsTitle: 'Contact Options',
  directContactMethodsSubtitle: 'Use the saved contact details below to reach the right inbox, phone line, or location.',
  directContactEmailActionLabel: 'Send email',
  directContactPhoneActionLabel: 'Call now',
  directContactFaxActionLabel: 'Call fax number',
  directContactDefaultActionLabel: 'Open',
  aboutCardTitle: 'About Me',
  aboutCardBody: 'Best for detailed project context.',
  aboutCardButtonLabel: 'Read About Me',
  aboutCardHref: '/about/',
  processEyebrow: 'Experience',
  processTitle: 'I Know The Process',
  processImages: [
    {
      imageUrl: '/uploads/GLOBAL/misc/Engineering.jpg',
      alt: 'Mega dust collector system with high efficiency fan.',
      caption: 'Mega dust collector system with a high-efficiency fan for lower energy consumption.'
    },
    {
      imageUrl: '/uploads/GLOBAL/misc/Software.jpeg',
      alt: 'Industrial software interface.',
      caption: 'Industrial and heavy-duty software packages.'
    }
  ]
};

const DEFAULT_PUBLIC_MENU_ITEMS = [
  { id: 'home', label: 'Home', href: '/', icon: 'bi-house', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'what-i-offer', label: 'What I Offer', href: '/whatIOffer', icon: 'bi-stars', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'news', label: 'News', href: '/news', icon: 'bi-newspaper', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'biography', label: 'Biography', href: '/biography', icon: 'bi-person-badge', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'contact', label: 'Contact', href: '/contact', icon: 'bi-envelope', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'about', label: 'About', href: '/about', icon: 'bi-info-circle', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'sign-in', label: 'Sign In', href: '/login', icon: 'bi-box-arrow-in-right', visibility: 'guest', target: '_self', active: true, children: [] }
];

const DEFAULT_APP_PUBLIC_MENU = {
  defaultHomePath: '/',
  items: DEFAULT_PUBLIC_MENU_ITEMS
};

// Updated Defaults mapping to constants.js structure
const DEFAULTS = {
  newsletter: {
    defaultGroupId: '',
    requireDoubleOptIn: false,
    sendWelcomeEmail: true
  },
  organization: {
    allowFreeRegistration: true,
    defaultTrialDays: 14,
    freeOrgId: 900000,          // NEW
    freeOrgName: 'Free User'   // NEW
  },
  access: {                     // NEW SECTION
    highAccessMin: 8,
    highAccessMax: 10,
    selfAccessLevel: 1,
    immuneSuperAdmins: ['admin@localhost.com', 'root@system.local']
  },
  app: {                        // NEW SECTION
    defaultPageSize: 30,
    searchDefaultKeyword: 'aaa',
    uploadsPath: 'uploads', // Store as string, resolve at runtime
    uploadFolders: uploadFolderSettingsService.getDefaultUploadFolders(),
    schoolCanonicalEnrollmentRead: false,
    schoolCanonicalEnrollmentWrite: false,
    schoolIntentionalConflictMode: false,
    schoolReadModelsEnabled: false,
    brand: DEFAULT_APP_BRAND,
    contact: DEFAULT_APP_CONTACT,
    contactPage: DEFAULT_APP_CONTACT_PAGE,
    publicMenu: DEFAULT_APP_PUBLIC_MENU
  }
};

const RUNTIME_BACKEND_SETTING_KEYS = new Set([
  'dataBackendMode',
  'mongoUri',
  'mongodbUri',
  'mongoDb',
  'mongoDatabase',
  'mongodbDb',
  'mongoConnectionString',
  'mongoConnectionUri'
]);

function stripRuntimeBackendSettings(app = {}) {
  const source = app && typeof app === 'object' ? app : {};
  const cleaned = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!RUNTIME_BACKEND_SETTING_KEYS.has(key)) {
      cleaned[key] = value;
    }
  });
  return cleaned;
}

function mergeAppSettings(base = {}, incoming = {}) {
  const baseApp = stripRuntimeBackendSettings(base);
  const incomingApp = stripRuntimeBackendSettings(incoming);
  const basePublicMenu = baseApp.publicMenu && typeof baseApp.publicMenu === 'object' && !Array.isArray(baseApp.publicMenu)
    ? baseApp.publicMenu
    : {};
  const incomingPublicMenu = incomingApp.publicMenu && typeof incomingApp.publicMenu === 'object' && !Array.isArray(incomingApp.publicMenu)
    ? incomingApp.publicMenu
    : {};
  const publicMenuItems = Array.isArray(incomingPublicMenu.items)
    ? incomingPublicMenu.items
    : (Array.isArray(basePublicMenu.items) ? basePublicMenu.items : DEFAULT_PUBLIC_MENU_ITEMS);

  return {
    ...baseApp,
    ...incomingApp,
    brand: {
      ...DEFAULT_APP_BRAND,
      ...(baseApp.brand || {}),
      ...(incomingApp.brand || {})
    },
    contact: {
      ...DEFAULT_APP_CONTACT,
      ...(baseApp.contact || {}),
      ...(incomingApp.contact || {})
    },
    contactPage: {
      ...DEFAULT_APP_CONTACT_PAGE,
      ...(baseApp.contactPage || {}),
      ...(incomingApp.contactPage || {}),
      highlights: Array.isArray(incomingApp.contactPage?.highlights)
        ? incomingApp.contactPage.highlights
        : (Array.isArray(baseApp.contactPage?.highlights) ? baseApp.contactPage.highlights : DEFAULT_APP_CONTACT_PAGE.highlights),
      processImages: Array.isArray(incomingApp.contactPage?.processImages)
        ? incomingApp.contactPage.processImages
        : (Array.isArray(baseApp.contactPage?.processImages) ? baseApp.contactPage.processImages : DEFAULT_APP_CONTACT_PAGE.processImages)
    },
    publicMenu: {
      ...DEFAULT_APP_PUBLIC_MENU,
      ...basePublicMenu,
      ...incomingPublicMenu,
      items: publicMenuItems
    },
    uploadFolders: uploadFolderSettingsService.mergeUploadFolderSettings(
      DEFAULTS.app.uploadFolders,
      baseApp.uploadFolders,
      incomingApp.uploadFolders
    )
  };
}

async function getSettings() {
  try {
    const data = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(data);
    
    // Deep merge defaults to ensure new fields appear if file exists but is old
    return { 
      newsletter: { ...DEFAULTS.newsletter, ...(parsed.newsletter || {}) },
      organization: { ...DEFAULTS.organization, ...(parsed.organization || {}) },
      access: { ...DEFAULTS.access, ...(parsed.access || {}) },
      app: mergeAppSettings(DEFAULTS.app, parsed.app || {})
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await initSettings();
      return DEFAULTS;
    }
    return DEFAULTS;
  }
}

async function initSettings() {
  await queueWrite(async () => {
    await fs.writeFile(settingsPath, JSON.stringify(DEFAULTS, null, 2));
  });
}

async function updateSettings(newSettings, auditUser) {
  await queueWrite(async () => {
    const current = await getSettings();
    
    const merged = {
      newsletter: { ...current.newsletter, ...(newSettings.newsletter || {}) },
      organization: { ...current.organization, ...(newSettings.organization || {}) },
      access: { ...current.access, ...(newSettings.access || {}) },
      app: mergeAppSettings(current.app, newSettings.app || {}),
      audit: {
        lastUpdateUser: auditUser ? auditUser.id : 'system',
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2));
  });
}

module.exports = {
  DEFAULTS,
  DEFAULT_PUBLIC_MENU_ITEMS,
  stripRuntimeBackendSettings,
  getSettings,
  updateSettings
};
