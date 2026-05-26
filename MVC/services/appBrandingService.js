const settingService = require('./settingService');
const packageNavigationService = require('./packageNavigationService');

const DEFAULT_BRAND = Object.freeze({
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
  youtubeUrl: '',
  headerShowBuyMeACoffee: true,
  headerBuyMeACoffeeUrl: 'https://www.buymeacoffee.com/paknejad',
  headerBuyMeACoffeeLabel: 'Support',
  headerBuyMeACoffeeText: 'Buy me a coffee',
  headerBuyMeACoffeeTitle: 'Support the work - one coffee at a time.'
});

const DEFAULT_CONTACT = Object.freeze({
  email: 'paknejad@live.com',
  collegeEmail: '',
  phone: '+1 (437) 602-8720',
  address: 'Calgary, Alberta',
  faxes: []
});

const DEFAULT_CONTACT_PAGE = Object.freeze({
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
});

const DEFAULT_PUBLIC_MENU_ITEMS = Object.freeze([
  { id: 'home', label: 'Home', href: '/', icon: 'bi-house', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'what-i-offer', label: 'What I Offer', href: '/whatIOffer', icon: 'bi-stars', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'news', label: 'News', href: '/news', icon: 'bi-newspaper', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'biography', label: 'Biography', href: '/biography', icon: 'bi-person-badge', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'contact', label: 'Contact', href: '/contact', icon: 'bi-envelope', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'about', label: 'About', href: '/about', icon: 'bi-info-circle', visibility: 'all', target: '_self', active: true, children: [] },
  { id: 'sign-in', label: 'Sign In', href: '/login', icon: 'bi-box-arrow-in-right', visibility: 'guest', target: '_self', active: true, children: [] }
]);

const DEFAULT_PUBLIC_HOME_PATH = '/';

const PUBLIC_MENU_ENDPOINT_OPTIONS = Object.freeze([
  { label: 'Home', href: '/', icon: 'bi-house', visibility: 'all', target: '_self', category: 'Core' },
  { label: 'What I Offer', href: '/whatIOffer', icon: 'bi-stars', visibility: 'all', target: '_self', category: 'Core' },
  { label: 'News', href: '/news', icon: 'bi-newspaper', visibility: 'all', target: '_self', category: 'Core' },
  { label: 'Biography', href: '/biography', icon: 'bi-person-badge', visibility: 'all', target: '_self', category: 'Core' },
  { label: 'Contact', href: '/contact', icon: 'bi-envelope', visibility: 'all', target: '_self', category: 'Core' },
  { label: 'About', href: '/about', icon: 'bi-info-circle', visibility: 'all', target: '_self', category: 'Core' },
  { label: 'Create Account', href: '/persons/join', icon: 'bi-person-plus', visibility: 'guest', target: '_self', category: 'Account' },
  { label: 'Register', href: '/persons/register', icon: 'bi-pencil-square', visibility: 'guest', target: '_self', category: 'Account' },
  { label: 'Sign In', href: '/login', icon: 'bi-box-arrow-in-right', visibility: 'guest', target: '_self', category: 'Account' },
  { label: 'Password Reset', href: '/password-reset', icon: 'bi-key', visibility: 'guest', target: '_self', category: 'Account' },
  { label: 'Newsletter Unsubscribe', href: '/newsletter/unsubscribe', icon: 'bi-envelope-x', visibility: 'all', target: '_self', category: 'Newsletter' }
]);

const REMOVED_PUBLIC_MENU_HREFS = new Set(['/pte/test-info', '/pte/join', '/pte/packages']);
const REMOVED_PUBLIC_MENU_LABELS = new Set(['pte test info', 'join pte practice', 'pte packages']);

function cleanText(value, { max = 4000, fallback = '' } = {}) {
  const token = String(value ?? '').replace(/\0/g, '').trim();
  const out = token || fallback || '';
  return out.length > max ? out.slice(0, max) : out;
}

function cleanOptionalText(value, { max = 4000, fallback = '' } = {}) {
  if (value === undefined || value === null) {
    const out = String(fallback || '');
    return out.length > max ? out.slice(0, max) : out;
  }
  const token = String(value).replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function cleanColor(value, fallback = '#ffffff') {
  const token = cleanText(value, { max: 40, fallback });
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(token) ? token : fallback;
}

function cleanUrl(value, fallback = '') {
  const token = cleanText(value, { max: 1200, fallback: '' });
  if (!token) return fallback || '';
  // Spaces are common in uploaded folder/file names. Keep the setting human-friendly,
  // but emit a browser-safe URL for HTML, CSS, and manifest consumers.
  if (/[\t\r\n"'`<>\\]/.test(token)) return fallback || '';
  if (/^(https?:)?\/\//i.test(token) || token.startsWith('/')) return token.replace(/ /g, '%20');
  return fallback || '';
}

function normalizeContactRows(rows, valueKey, legacyRows = [], fallbackTitle = '') {
  const source = Array.isArray(rows) ? rows : legacyRows;
  return source
    .map((row) => {
      const sourceRow = row && typeof row === 'object' ? row : {};
      const title = cleanText(sourceRow.title || sourceRow.label || '', { max: 120, fallback: '' });
      const value = cleanText(sourceRow[valueKey] || sourceRow.value || '', { max: valueKey === 'address' ? 500 : 240, fallback: '' });
      if (!value) return null;
      return {
        title: title || fallbackTitle || (valueKey === 'email' ? 'Email' : valueKey === 'number' ? 'Phone' : 'Address'),
        [valueKey]: value
      };
    })
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanHtmlHref(value) {
  const token = cleanText(value, { max: 1200, fallback: '' });
  if (!token || /[\s"'`<>\\]/.test(token)) return '';
  if (/^(https?:|mailto:|tel:|\/)/i.test(token)) return token;
  return '';
}

function cleanMenuHref(value) {
  const token = cleanText(value, { max: 1200, fallback: '' });
  if (!token || /[\s"'`<>\\]/.test(token)) return '';
  if (/^\/(?!\/)/.test(token)) return token;
  if (/^https:\/\//i.test(token)) return token;
  if (/^(mailto:|tel:)/i.test(token)) return token;
  return '';
}

function cleanInternalRoute(value) {
  const href = cleanMenuHref(value);
  if (!href) return '';
  if (href === '/') return '/';
  return /^\/(?!\/)/.test(href) ? href : '';
}

function cleanMenuIcon(value) {
  const token = cleanText(value, { max: 80, fallback: '' });
  if (!token || !/^[a-z0-9 _-]+$/i.test(token)) return '';
  const parts = token.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const iconPart = parts.find((part) => /^bi-[a-z0-9-]+$/i.test(part));
  if (iconPart) return iconPart;
  const first = parts.find((part) => part.toLowerCase() !== 'bi') || '';
  if (!first) return '';
  return first.startsWith('bi-') ? first : `bi-${first.replace(/^-+/, '')}`;
}

function sanitizeFooterHtml(value, fallback = '') {
  const raw = cleanText(value, { max: 4000, fallback });
  const allowedTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'span', 'small', 'div', 'blockquote', 'code']);
  const voidTags = new Set(['br']);
  let output = '';
  let lastIndex = 0;

  raw.replace(/<\/?([a-z][a-z0-9-]*)([^>]*)>/gi, (match, tagName, attrs, offset) => {
    const tag = String(tagName || '').toLowerCase();
    output += escapeHtml(raw.slice(lastIndex, offset));
    lastIndex = offset + match.length;

    if (!allowedTags.has(tag)) return '';
    if (match.startsWith('</')) {
      if (!voidTags.has(tag)) output += `</${tag}>`;
      return '';
    }

    if (tag === 'a') {
      const hrefMatch = String(attrs || '').match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = cleanHtmlHref(hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '') : '');
      const titleMatch = String(attrs || '').match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const title = cleanText(titleMatch ? (titleMatch[1] || titleMatch[2] || titleMatch[3] || '') : '', { max: 200, fallback: '' });
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      const relAttr = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      output += href ? `<a href="${escapeHtml(href)}"${titleAttr}${relAttr}>` : '<a>';
      return '';
    }

    output += voidTags.has(tag) ? `<${tag}>` : `<${tag}>`;
    return '';
  });

  output += escapeHtml(raw.slice(lastIndex));
  return output.trim() || escapeHtml(fallback || '');
}

function getRawBrandSettings() {
  try {
    const settings = settingService.get();
    const appSettings = settings && settings.app && typeof settings.app === 'object' ? settings.app : {};
    const brand = appSettings.brand && typeof appSettings.brand === 'object' && !Array.isArray(appSettings.brand)
      ? appSettings.brand
      : {};
    return {
      ...(appSettings.appName ? { appName: appSettings.appName } : {}),
      ...(appSettings.appShortName ? { appShortName: appSettings.appShortName } : {}),
      ...brand
    };
  } catch (_) {
    return {};
  }
}

function getRawContactSettings() {
  try {
    const settings = settingService.get();
    const appSettings = settings && settings.app && typeof settings.app === 'object' ? settings.app : {};
    return appSettings.contact && typeof appSettings.contact === 'object' && !Array.isArray(appSettings.contact)
      ? appSettings.contact
      : {};
  } catch (_) {
    return {};
  }
}

function getRawContactPageSettings() {
  try {
    const settings = settingService.get();
    const appSettings = settings && settings.app && typeof settings.app === 'object' ? settings.app : {};
    return appSettings.contactPage && typeof appSettings.contactPage === 'object' && !Array.isArray(appSettings.contactPage)
      ? appSettings.contactPage
      : {};
  } catch (_) {
    return {};
  }
}

function getRawPublicMenuSettings() {
  try {
    const settings = settingService.get();
    const appSettings = settings && settings.app && typeof settings.app === 'object' ? settings.app : {};
    return appSettings.publicMenu && typeof appSettings.publicMenu === 'object' && !Array.isArray(appSettings.publicMenu)
      ? appSettings.publicMenu
      : {};
  } catch (_) {
    return {};
  }
}

function getBrand() {
  const raw = getRawBrandSettings();
  const merged = { ...DEFAULT_BRAND, ...raw };

  return {
    appName: cleanText(merged.appName, { max: 180, fallback: DEFAULT_BRAND.appName }),
    appShortName: cleanText(merged.appShortName, { max: 80, fallback: DEFAULT_BRAND.appShortName }),
    tagline: cleanText(merged.tagline, { max: 240, fallback: DEFAULT_BRAND.tagline }),
    logoUrl: cleanUrl(merged.logoUrl, DEFAULT_BRAND.logoUrl),
    iconSvgUrl: cleanUrl(merged.iconSvgUrl, DEFAULT_BRAND.iconSvgUrl),
    appleTouchIconUrl: cleanUrl(merged.appleTouchIconUrl, DEFAULT_BRAND.appleTouchIconUrl),
    themeColor: cleanColor(merged.themeColor, DEFAULT_BRAND.themeColor),
    ownerDisplayName: cleanText(merged.ownerDisplayName, { max: 180, fallback: DEFAULT_BRAND.ownerDisplayName }),
    footerAboutTitle: cleanText(merged.footerAboutTitle, { max: 220, fallback: DEFAULT_BRAND.footerAboutTitle }),
    footerAboutText: cleanText(merged.footerAboutText, { max: 4000, fallback: DEFAULT_BRAND.footerAboutText }),
    footerAboutHtml: sanitizeFooterHtml(merged.footerAboutText, DEFAULT_BRAND.footerAboutText),
    footerLogoAlt: cleanText(merged.footerLogoAlt, { max: 220, fallback: DEFAULT_BRAND.footerLogoAlt }),
    footerShowNewsletter: merged.footerShowNewsletter !== false,
    instagramUrl: cleanUrl(merged.instagramUrl, ''),
    facebookUrl: cleanUrl(merged.facebookUrl, ''),
    linkedinUrl: cleanUrl(merged.linkedinUrl, ''),
    youtubeUrl: cleanUrl(merged.youtubeUrl, ''),
    headerShowBuyMeACoffee: merged.headerShowBuyMeACoffee !== false,
    headerBuyMeACoffeeUrl: cleanUrl(merged.headerBuyMeACoffeeUrl, DEFAULT_BRAND.headerBuyMeACoffeeUrl),
    headerBuyMeACoffeeLabel: cleanText(merged.headerBuyMeACoffeeLabel, { max: 80, fallback: DEFAULT_BRAND.headerBuyMeACoffeeLabel }),
    headerBuyMeACoffeeText: cleanText(merged.headerBuyMeACoffeeText, { max: 120, fallback: DEFAULT_BRAND.headerBuyMeACoffeeText }),
    headerBuyMeACoffeeTitle: cleanText(merged.headerBuyMeACoffeeTitle, { max: 220, fallback: DEFAULT_BRAND.headerBuyMeACoffeeTitle })
  };
}

function getContact() {
  const raw = getRawContactSettings();
  const merged = { ...DEFAULT_CONTACT, ...raw };
  const legacyEmailRows = [];
  if (merged.email) legacyEmailRows.push({ title: 'General Inquiries', email: merged.email });
  const emails = normalizeContactRows(merged.emails, 'email', legacyEmailRows, 'Email');
  const phones = normalizeContactRows(merged.phones, 'number', merged.phone ? [{ title: 'Phone', number: merged.phone }] : [], 'Phone');
  const faxes = normalizeContactRows(merged.faxes, 'number', merged.fax ? [{ title: 'Fax', number: merged.fax }] : [], 'Fax');
  const addresses = normalizeContactRows(merged.addresses, 'address', merged.address ? [{ title: 'Address', address: merged.address }] : [], 'Address');

  return {
    emails,
    phones,
    faxes,
    addresses,
    email: emails[0]?.email || '',
    supportEmail: emails[0]?.email || '',
    collegeEmail: '',
    phone: phones[0]?.number || '',
    fax: faxes[0]?.number || '',
    address: addresses[0]?.address || ''
  };
}

function normalizeContactHighlights(rows) {
  const source = Array.isArray(rows) ? rows : DEFAULT_CONTACT_PAGE.highlights;
  return source
    .slice(0, 6)
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : {};
      const fallback = DEFAULT_CONTACT_PAGE.highlights[index] || {};
      return {
        title: cleanText(item.title, { max: 120, fallback: fallback.title || '' }),
        body: cleanText(item.body, { max: 280, fallback: fallback.body || '' })
      };
    })
    .filter((row) => row.title || row.body);
}

function normalizeContactProcessImages(rows) {
  const source = Array.isArray(rows) ? rows : DEFAULT_CONTACT_PAGE.processImages;
  return source
    .slice(0, 6)
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : {};
      const fallback = DEFAULT_CONTACT_PAGE.processImages[index] || {};
      return {
        imageUrl: cleanUrl(item.imageUrl, fallback.imageUrl || ''),
        alt: cleanText(item.alt, { max: 240, fallback: fallback.alt || '' }),
        caption: cleanText(item.caption, { max: 400, fallback: fallback.caption || '' })
      };
    })
    .filter((row) => row.imageUrl);
}

function getContactPage() {
  const raw = getRawContactPageSettings();
  const merged = { ...DEFAULT_CONTACT_PAGE, ...raw };

  return {
    heroEyebrow: cleanOptionalText(merged.heroEyebrow, { max: 120, fallback: DEFAULT_CONTACT_PAGE.heroEyebrow }),
    heroTitle: cleanOptionalText(merged.heroTitle, { max: 220, fallback: DEFAULT_CONTACT_PAGE.heroTitle }),
    heroSubtitle: cleanOptionalText(merged.heroSubtitle, { max: 600, fallback: DEFAULT_CONTACT_PAGE.heroSubtitle }),
    primaryCtaLabel: cleanOptionalText(merged.primaryCtaLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.primaryCtaLabel }),
    emailCtaLabel: cleanOptionalText(merged.emailCtaLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.emailCtaLabel }),
    followUpCtaLabel: cleanOptionalText(merged.followUpCtaLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.followUpCtaLabel }),
    highlights: normalizeContactHighlights(merged.highlights),
    formEyebrow: cleanOptionalText(merged.formEyebrow, { max: 120, fallback: DEFAULT_CONTACT_PAGE.formEyebrow }),
    formTitle: cleanOptionalText(merged.formTitle, { max: 180, fallback: DEFAULT_CONTACT_PAGE.formTitle }),
    formSubtitle: cleanOptionalText(merged.formSubtitle, { max: 400, fallback: DEFAULT_CONTACT_PAGE.formSubtitle }),
    formHint: cleanOptionalText(merged.formHint, { max: 700, fallback: DEFAULT_CONTACT_PAGE.formHint }),
    directContactKicker: cleanOptionalText(merged.directContactKicker, { max: 80, fallback: DEFAULT_CONTACT_PAGE.directContactKicker }),
    directContactTitle: cleanOptionalText(merged.directContactTitle, { max: 160, fallback: DEFAULT_CONTACT_PAGE.directContactTitle }),
    directContactLead: cleanOptionalText(merged.directContactLead, { max: 420, fallback: DEFAULT_CONTACT_PAGE.directContactLead }),
    directContactMethodsTitle: cleanOptionalText(merged.directContactMethodsTitle, { max: 160, fallback: DEFAULT_CONTACT_PAGE.directContactMethodsTitle }),
    directContactMethodsSubtitle: cleanOptionalText(merged.directContactMethodsSubtitle, { max: 360, fallback: DEFAULT_CONTACT_PAGE.directContactMethodsSubtitle }),
    directContactEmailActionLabel: cleanOptionalText(merged.directContactEmailActionLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.directContactEmailActionLabel }),
    directContactPhoneActionLabel: cleanOptionalText(merged.directContactPhoneActionLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.directContactPhoneActionLabel }),
    directContactFaxActionLabel: cleanOptionalText(merged.directContactFaxActionLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.directContactFaxActionLabel }),
    directContactDefaultActionLabel: cleanOptionalText(merged.directContactDefaultActionLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.directContactDefaultActionLabel }),
    aboutCardTitle: cleanOptionalText(merged.aboutCardTitle, { max: 160, fallback: DEFAULT_CONTACT_PAGE.aboutCardTitle }),
    aboutCardBody: cleanOptionalText(merged.aboutCardBody, { max: 400, fallback: DEFAULT_CONTACT_PAGE.aboutCardBody }),
    aboutCardButtonLabel: cleanOptionalText(merged.aboutCardButtonLabel, { max: 80, fallback: DEFAULT_CONTACT_PAGE.aboutCardButtonLabel }),
    aboutCardHref: cleanMenuHref(merged.aboutCardHref) || DEFAULT_CONTACT_PAGE.aboutCardHref,
    processEyebrow: cleanOptionalText(merged.processEyebrow, { max: 120, fallback: DEFAULT_CONTACT_PAGE.processEyebrow }),
    processTitle: cleanOptionalText(merged.processTitle, { max: 180, fallback: DEFAULT_CONTACT_PAGE.processTitle }),
    processImages: normalizeContactProcessImages(merged.processImages)
  };
}

function normalizePublicMenuItems(items, user = null, depth = 0) {
  if (!Array.isArray(items) || depth >= 6) return [];
  const isAuthenticated = Boolean(user);

  return items
    .map((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      if (source.active === false) return null;

      const label = cleanText(source.label, { max: 120, fallback: '' });
      if (!label) return null;

      const children = normalizePublicMenuItems(source.children, user, depth + 1);
      const href = cleanMenuHref(source.href);
      const rawHref = cleanText(source.href, { max: 1200, fallback: '' });
      if (rawHref && !href) return null;
      if (!href && !children.length) return null;

      const visibilityRaw = cleanText(source.visibility, { max: 32, fallback: 'all' }).toLowerCase();
      const visibility = ['all', 'guest', 'authenticated'].includes(visibilityRaw) ? visibilityRaw : 'all';
      if (visibility === 'guest' && isAuthenticated) return null;
      if (visibility === 'authenticated' && !isAuthenticated) return null;

      return {
        id: cleanText(source.id, { max: 120, fallback: `menu-${depth}-${index}` }),
        label,
        href,
        icon: cleanMenuIcon(source.icon),
        visibility,
        target: source.target === '_blank' ? '_blank' : '_self',
        active: true,
        children
      };
    })
    .filter(Boolean);
}

function dedupeMenuItems(items = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const source = item && typeof item === 'object' ? item : {};
    const href = cleanMenuHref(source.href || '');
    const label = cleanText(source.label, { max: 120, fallback: '' });
    const id = cleanText(source.id, { max: 120, fallback: `menu-item-${index + 1}` });
    const key = `${id}|${href}|${label}`.toLowerCase();
    if (!href || !label || seen.has(key)) return;
    seen.add(key);
    out.push({
      ...source,
      href,
      label,
      id
    });
  });
  return out;
}

function removeDeprecatedPublicMenuItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const source = item && typeof item === 'object' ? item : {};
    const href = cleanMenuHref(source.href || '');
    const label = cleanText(source.label, { max: 120, fallback: '' }).toLowerCase();
    if (href && REMOVED_PUBLIC_MENU_HREFS.has(href)) return false;
    if (label && REMOVED_PUBLIC_MENU_LABELS.has(label)) return false;
    return true;
  });
}

function getPublicMenu(user = null) {
  const raw = getRawPublicMenuSettings();
  const sourceItems = Array.isArray(raw.items) && raw.items.length ? raw.items : DEFAULT_PUBLIC_MENU_ITEMS;
  const filteredBaseItems = packageNavigationService.filterMenuItemsAgainstDisabledPackages(sourceItems);
  const cleanedBaseItems = removeDeprecatedPublicMenuItems(filteredBaseItems);
  const packageItems = packageNavigationService.getPublicMenuEntries(user);
  const cleanedPackageItems = removeDeprecatedPublicMenuItems(packageItems);
  const mergedItems = dedupeMenuItems([...(cleanedBaseItems || []), ...(cleanedPackageItems || [])]);
  const normalized = normalizePublicMenuItems(mergedItems, user, 0);
  if (normalized.length) return normalized;
  const fallbackItems = packageNavigationService.filterMenuItemsAgainstDisabledPackages(DEFAULT_PUBLIC_MENU_ITEMS);
  const cleanedFallbackItems = removeDeprecatedPublicMenuItems(fallbackItems);
  return normalizePublicMenuItems(cleanedFallbackItems, user, 0);
}

function getPublicDefaultHomePath() {
  const raw = getRawPublicMenuSettings();
  const configured = cleanInternalRoute(raw.defaultHomePath);
  return configured || DEFAULT_PUBLIC_HOME_PATH;
}

function getPublicMenuEndpointOptions() {
  const staticOptions = PUBLIC_MENU_ENDPOINT_OPTIONS.map((item) => ({
    label: cleanText(item.label, { max: 120, fallback: '' }),
    href: cleanMenuHref(item.href),
    icon: cleanMenuIcon(item.icon),
    visibility: ['all', 'guest', 'authenticated'].includes(item.visibility) ? item.visibility : 'all',
    target: item.target === '_blank' ? '_blank' : '_self',
    category: cleanText(item.category, { max: 80, fallback: 'Public' })
  })).filter((item) => item.label && item.href);
  const filteredStatic = packageNavigationService.filterMenuItemsAgainstDisabledPackages(staticOptions);
  const cleanedStatic = removeDeprecatedPublicMenuItems(filteredStatic);
  const packageOptions = packageNavigationService.getPublicMenuEntries(null).map((row) => ({
    label: cleanText(row.label, { max: 120, fallback: '' }),
    href: cleanMenuHref(row.href),
    icon: cleanMenuIcon(row.icon),
    visibility: ['all', 'guest', 'authenticated'].includes(row.visibility) ? row.visibility : 'all',
    target: row.target === '_blank' ? '_blank' : '_self',
    category: cleanText(row.sourcePackageName || row.category || 'Package', { max: 80, fallback: 'Package' })
  })).filter((item) => item.label && item.href);
  const cleanedPackageOptions = removeDeprecatedPublicMenuItems(packageOptions);
  const deduped = dedupeMenuItems([...cleanedStatic, ...cleanedPackageOptions]);
  return deduped.map((item) => ({
    label: cleanText(item.label, { max: 120, fallback: '' }),
    href: cleanMenuHref(item.href),
    icon: cleanMenuIcon(item.icon),
    visibility: ['all', 'guest', 'authenticated'].includes(item.visibility) ? item.visibility : 'all',
    target: item.target === '_blank' ? '_blank' : '_self',
    category: cleanText(item.category, { max: 80, fallback: 'Public' })
  })).filter((item) => item.label && item.href);
}

function getManifest() {
  const brand = getBrand();
  return {
    name: brand.appName,
    short_name: brand.appShortName,
    icons: [
      {
        src: brand.appleTouchIconUrl,
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: brand.appleTouchIconUrl,
        sizes: '512x512',
        type: 'image/png'
      }
    ],
    theme_color: brand.themeColor,
    background_color: brand.themeColor,
    display: 'standalone'
  };
}

module.exports = {
  DEFAULT_BRAND,
  DEFAULT_CONTACT,
  DEFAULT_CONTACT_PAGE,
  DEFAULT_PUBLIC_MENU_ITEMS,
  PUBLIC_MENU_ENDPOINT_OPTIONS,
  getBrand,
  getContact,
  getContactPage,
  getPublicMenu,
  getPublicDefaultHomePath,
  getPublicMenuEndpointOptions,
  getManifest
};
