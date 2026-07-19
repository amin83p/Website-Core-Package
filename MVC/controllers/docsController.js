const fs = require('fs');
const path = require('path');
const { formatInstantInTimezone } = require('../utils/timezoneUtils');

const DOCS_ROOT = path.resolve(__dirname, '../../docs');
const MAX_VIEWABLE_BYTES = 2 * 1024 * 1024; // 2 MB

const TEXT_VIEWABLE_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.log',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.ejs',
  '.html',
  '.css'
]);

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeRequestedPath(rawPath) {
  const input = String(rawPath || '').trim();
  if (!input) return null;

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) return null;

  const absolutePath = path.resolve(DOCS_ROOT, normalized);
  const rootPrefix = DOCS_ROOT.endsWith(path.sep) ? DOCS_ROOT : `${DOCS_ROOT}${path.sep}`;

  if (absolutePath !== DOCS_ROOT && !absolutePath.startsWith(rootPrefix)) return null;
  return { relativePath: normalized, absolutePath };
}

function listDocsFiles(timeZone = 'UTC') {
  if (!fs.existsSync(DOCS_ROOT)) return [];

  const files = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    entries.forEach((entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        return;
      }
      if (!entry.isFile()) return;

      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(DOCS_ROOT, absolutePath).split(path.sep).join('/');
      const ext = path.extname(entry.name || '').toLowerCase();
      const folder = relativePath.includes('/') ? relativePath.split('/')[0] : 'root';
      const updatedAt = stat.mtime instanceof Date ? stat.mtime : new Date();

      files.push({
        name: entry.name,
        relativePath,
        folder,
        ext,
        size: Number(stat.size || 0),
        sizeLabel: formatBytes(stat.size),
        updatedAt,
        updatedAtLabel: formatInstantInTimezone(updatedAt, timeZone),
        isTextViewable: TEXT_VIEWABLE_EXTS.has(ext)
      });
    });
  };

  walk(DOCS_ROOT);
  return files.sort((a, b) => String(a.relativePath || '').localeCompare(String(b.relativePath || '')));
}

function buildGroups(files) {
  const map = new Map();
  (Array.isArray(files) ? files : []).forEach((file) => {
    const key = String(file?.folder || 'root');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(file);
  });
  return Array.from(map.entries())
    .map(([folder, rows]) => ({ folder, files: rows }))
    .sort((a, b) => String(a.folder || '').localeCompare(String(b.folder || '')));
}

async function docsHome(req, res) {
  try {
    const orgTimeZone = req.orgTimeZone || req.user?.activeOrgTimeZone || 'UTC';
    const files = listDocsFiles(orgTimeZone);
    const warning = String(req.query.warning || '').trim();

    res.render('docs/index', {
      title: 'Documentation',
      user: req.user || null,
      files,
      fileGroups: buildGroups(files),
      warning,
      docsRootPath: 'docs'
    });
  } catch (error) {
    console.error('Docs Home Error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load the documentation page.',
      user: req.user || null
    });
  }
}

async function viewDocument(req, res) {
  try {
    const target = normalizeRequestedPath(req.query.path);
    if (!target) {
      return res.status(400).render('error', {
        title: 'Invalid Document',
        message: 'The requested document path is invalid.',
        user: req.user || null
      });
    }

    if (!fs.existsSync(target.absolutePath)) {
      return res.status(404).render('error', {
        title: 'Document Not Found',
        message: 'The requested document does not exist.',
        user: req.user || null
      });
    }

    const stat = fs.statSync(target.absolutePath);
    if (!stat.isFile()) {
      return res.status(400).render('error', {
        title: 'Invalid Document',
        message: 'The requested path is not a file.',
        user: req.user || null
      });
    }

    const ext = path.extname(target.absolutePath || '').toLowerCase();
    if (!TEXT_VIEWABLE_EXTS.has(ext)) {
      return res.redirect(`/docs?warning=${encodeURIComponent('This file cannot be previewed in browser. Please use download.')}`);
    }

    if (stat.size > MAX_VIEWABLE_BYTES) {
      return res.redirect(`/docs?warning=${encodeURIComponent('This file is too large to preview. Please download it instead.')}`);
    }

    const orgTimeZone = req.orgTimeZone || req.user?.activeOrgTimeZone || 'UTC';
    const content = fs.readFileSync(target.absolutePath, 'utf8');

    return res.render('docs/view', {
      title: `Documentation - ${target.relativePath}`,
      user: req.user || null,
      doc: {
        relativePath: target.relativePath,
        ext,
        sizeLabel: formatBytes(stat.size),
        updatedAtLabel: formatInstantInTimezone(stat.mtime instanceof Date ? stat.mtime : new Date(), orgTimeZone)
      },
      content
    });
  } catch (error) {
    console.error('View Document Error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to open the requested document.',
      user: req.user || null
    });
  }
}

async function downloadDocument(req, res) {
  try {
    const target = normalizeRequestedPath(req.query.path);
    if (!target) {
      return res.status(400).render('error', {
        title: 'Invalid Document',
        message: 'The requested document path is invalid.',
        user: req.user || null
      });
    }
    if (!fs.existsSync(target.absolutePath) || !fs.statSync(target.absolutePath).isFile()) {
      return res.status(404).render('error', {
        title: 'Document Not Found',
        message: 'The requested document does not exist.',
        user: req.user || null
      });
    }
    return res.download(target.absolutePath, path.basename(target.absolutePath));
  } catch (error) {
    console.error('Download Document Error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to download the requested document.',
      user: req.user || null
    });
  }
}

module.exports = {
  docsHome,
  viewDocument,
  downloadDocument
};
