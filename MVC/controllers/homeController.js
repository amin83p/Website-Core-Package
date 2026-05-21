const fs = require('fs/promises');
const path = require('path');
const dataService = require('../services/dataService');
const symbolRepository = require('../repositories/symbolRepository');
const uploadPathUtils = require('../utils/uploadPathUtils');
const appBrandingService = require('../services/appBrandingService');
const publicPageContentSettingsDataService = require('../services/publicPageContentSettingsDataService');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

async function getHome(req, res) {
  const defaultHomePath = appBrandingService.getPublicDefaultHomePath();
  if (defaultHomePath && defaultHomePath !== '/') {
    const query = new URLSearchParams(req.query || {}).toString();
    const redirectTarget = query ? `${defaultHomePath}?${query}` : defaultHomePath;
    return res.redirect(redirectTarget);
  }

  let heroSlides = [];
  let homeShowcaseItems = [];
  let buyMeACoffeeQr = null;
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  let publicPageContent = null;
  let homeContent = null;

  try {
    publicPageContent = await publicPageContentSettingsDataService.getPublicPageContentModel();
    homeContent = publicPageContent.home || null;
    homeShowcaseItems = Array.isArray(homeContent?.imageShowcase) ? homeContent.imageShowcase : [];
  } catch (error) {
    console.error('Public page content load error:', error);
  }

  if (homeShowcaseItems.length) {
    heroSlides = homeShowcaseItems.map((item) => item.src).filter(Boolean);
  }

  try {
    // Support both directory names: imageSlide (requested) and imageSlides (existing).
    const slideDirs = ['imageSlide', 'imageSlides'];
    let selectedDir = null;

    for (const dirName of slideDirs) {
      const absDir = path.join(uploadRoot, 'GLOBAL', 'misc', dirName);
      try {
        const stat = await fs.stat(absDir);
        if (stat.isDirectory()) {
          selectedDir = dirName;
          break;
        }
      } catch (_) {
        // Continue trying alternate directory names.
      }
    }

    if (!heroSlides.length && selectedDir) {
      const absSelectedDir = path.join(uploadRoot, 'GLOBAL', 'misc', selectedDir);
      const files = await fs.readdir(absSelectedDir, { withFileTypes: true });

      heroSlides = files
        .filter(f => f.isFile() && ALLOWED_IMAGE_EXTENSIONS.has(path.extname(f.name).toLowerCase()))
        .map(f => f.name)
        .sort((a, b) => a.localeCompare(b))
        .map(fileName => `/uploads/GLOBAL/misc/${selectedDir}/${fileName}`);
    }
  } catch (error) {
    console.error('Home slides load error:', error);
  }

  // Stable fallback if slide folder is empty/missing.
  if (!heroSlides.length) {
    heroSlides = [
      '/uploads/GLOBAL/misc/Engineering.jpg',
      '/uploads/GLOBAL/misc/Software.jpeg',
      '/uploads/GLOBAL/misc/Teaching.jpg'
    ];
  }

  if (!homeShowcaseItems.length) {
    homeShowcaseItems = heroSlides.map((src, index) => ({
      src,
      alt: `Integrated systems slide ${index + 1}`,
      title: index === 0 ? 'From schools to factories, we connect strategy with real execution.' : '',
      caption: index === 0 ? 'Integrated platforms, measurable outcomes, and continuous improvement.' : '',
      durationMs: 4500,
      active: true,
      order: (index + 1) * 10
    }));
  }

  try {
    const donateSymbol = await dataService.getSymbolByLabel('BYMEACOFFEE', req.user || null);
    buyMeACoffeeQr = donateSymbol && donateSymbol.type === 'image' ? donateSymbol.value : null;
  } catch (error) {
    console.error('Buy Me a Coffee symbol load error:', error);
  }

  // Fallback for public/home rendering when scoped symbol access returns empty.
  if (!buyMeACoffeeQr) {
    try {
      const allSymbols = await symbolRepository.list({
        query: {},
        scope: { canViewAll: true }
      });
      const donateSymbol = allSymbols.find((symbol) => {
        const tags = Array.isArray(symbol.tags) ? symbol.tags : [];
        const hasDonateTag = tags.includes('BYMEACOFFEE') || symbol.name === 'BYMEACOFFEE';
        const isGlobalSymbol = String(symbol.orgId || '').toUpperCase() === 'SYSTEM' || !symbol.orgId;
        return symbol.type === 'image' && hasDonateTag && isGlobalSymbol && symbol.value;
      });

      buyMeACoffeeQr = donateSymbol ? donateSymbol.value : null;
    } catch (error) {
      console.error('Buy Me a Coffee fallback symbol load error:', error);
    }
  }

  res.render('index', {
    title: `Home - ${appBrandingService.getBrand().appName}`,
    includeModal: true,
    htmlClass: 'pte-public-root home-public-root',
    bodyClass: 'pte-public-body home-public-body public-zoom-centered-body',
    mainClass: 'container pte-public-main home-public-main',
    user: req.user || null,
    publicPageContent,
    homeContent,
    heroSlides,
    homeShowcaseItems,
    buyMeACoffeeQr
  });
}

module.exports = { getHome };
