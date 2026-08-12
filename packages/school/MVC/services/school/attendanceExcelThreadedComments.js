// MVC/services/school/attendanceExcelThreadedComments.js
const crypto = require('crypto');
const JSZip = require('jszip');

const PERSON_CONTENT_TYPE = 'application/vnd.ms-excel.person+xml';
const THREADED_COMMENT_CONTENT_TYPE = 'application/vnd.ms-excel.threadedcomments+xml';
const COMMENTS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml';
const VML_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.vmlDrawing';
const PERSON_REL_TYPE = 'http://schemas.microsoft.com/office/2017/10/relationships/person';
const THREADED_COMMENT_REL_TYPE = 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment';
const COMMENTS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const VML_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing';

const THREADED_COMPAT_PREAMBLE = [
  '[Threaded comment]',
  '',
  'Your version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924',
  ''
].join('\n');

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function newGuid() {
  const raw = crypto.randomUUID().toUpperCase();
  return `{${raw}}`;
}

function personKey({ authorName = '', authorEmail = '' } = {}) {
  const email = String(authorEmail || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(authorName || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return 'name:attendance';
}

function nextRelationshipId(relsXml = '') {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let match = re.exec(relsXml);
  while (match) {
    max = Math.max(max, Number(match[1]) || 0);
    match = re.exec(relsXml);
  }
  return `rId${max + 1}`;
}

function ensureRelationship(relsXml, { type, target }) {
  const existing = new RegExp(
    `Type="${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*Target="${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
  );
  if (existing.test(relsXml)) return relsXml;

  const id = nextRelationshipId(relsXml);
  const relationship = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  if (/<\/Relationships>/.test(relsXml)) {
    return relsXml.replace('</Relationships>', `${relationship}</Relationships>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `${relationship}</Relationships>`;
}

function findRelationshipId(relsXml, { type, target }) {
  const re = new RegExp(
    `<Relationship[^>]*Id="(rId\\d+)"[^>]*Type="${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*Target="${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
    + `|<Relationship[^>]*Type="${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*Target="${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*Id="(rId\\d+)"`
  );
  const match = re.exec(relsXml || '');
  return match ? (match[1] || match[2] || '') : '';
}

function ensureContentTypeOverride(contentTypesXml, { partName, contentType }) {
  const already = new RegExp(`PartName="${partName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  if (already.test(contentTypesXml)) return contentTypesXml;
  const override = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return contentTypesXml.replace('</Types>', `${override}</Types>`);
}

function ensureContentTypeDefault(contentTypesXml, { extension, contentType }) {
  const already = new RegExp(`Extension="${extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  if (already.test(contentTypesXml)) return contentTypesXml;
  const def = `<Default Extension="${extension}" ContentType="${contentType}"/>`;
  if (/<Default[\s>]/.test(contentTypesXml)) {
    return contentTypesXml.replace(/<Default[\s>]/, `${def}$&`);
  }
  return contentTypesXml.replace('<Types', `<Types`).replace('>', `>${def}`);
}

function buildPersonListXml(persons = []) {
  const rows = persons.map((person) => {
    const displayName = escapeXml(person.displayName || 'Attendance');
    const id = escapeXml(person.id);
    const userId = escapeXml(person.userId || '');
    const providerId = escapeXml(person.providerId || 'None');
    return `<person displayName="${displayName}" id="${id}" userId="${userId}" providerId="${providerId}"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"`
    + ` xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `${rows}</personList>`;
}

function buildThreadedCommentsXml(threads = []) {
  const rows = [];
  threads.forEach((thread) => {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    if (!messages.length) return;
    let parentId = '';
    messages.forEach((message, index) => {
      const id = message.id || newGuid();
      if (index === 0) parentId = id;
      const attrs = [
        `ref="${escapeXml(thread.ref)}"`,
        `dT="${escapeXml(message.timestamp || new Date().toISOString())}"`,
        `personId="${escapeXml(message.personId)}"`,
        `id="${escapeXml(id)}"`
      ];
      if (index > 0 && parentId) attrs.push(`parentId="${escapeXml(parentId)}"`);
      rows.push(
        `<threadedComment ${attrs.join(' ')}>`
        + `<text>${escapeXml(message.text || '')}</text>`
        + `</threadedComment>`
      );
    });
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"`
    + ` xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `${rows.join('')}</ThreadedComments>`;
}

function resolvePersonsAndThreads(cellThreads = []) {
  const personByKey = new Map();
  const threads = [];

  cellThreads.forEach((cellThread) => {
    const ref = String(cellThread?.ref || '').trim();
    const messagesIn = Array.isArray(cellThread?.messages) ? cellThread.messages : [];
    if (!ref || !messagesIn.length) return;

    const messages = messagesIn.map((message) => {
      const authorName = String(message?.authorName || 'Attendance').trim() || 'Attendance';
      const authorEmail = String(message?.authorEmail || '').trim();
      const key = personKey({ authorName, authorEmail });
      if (!personByKey.has(key)) {
        personByKey.set(key, {
          id: newGuid(),
          displayName: authorName,
          userId: authorEmail,
          providerId: 'None'
        });
      }
      const person = personByKey.get(key);
      return {
        id: newGuid(),
        personId: person.id,
        authorName,
        authorEmail,
        text: String(message?.text || '').trim(),
        timestamp: String(message?.timestamp || new Date().toISOString()).trim()
          || new Date().toISOString()
      };
    }).filter((message) => message.text);

    if (!messages.length) return;
    threads.push({ ref, messages });
  });

  return {
    persons: [...personByKey.values()],
    threads
  };
}

/** Parse A1 ref like J11 / AA10 into 0-based row/col for VML ClientData. */
function parseA1Ref(ref = '') {
  const match = /^([A-Za-z]+)(\d+)$/.exec(String(ref || '').trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = (col * 26) + (letters.charCodeAt(i) - 64);
  }
  const row = Number(match[2]);
  if (!row || col < 1) return null;
  return { col0: col - 1, row0: row - 1, col1: col, row1: row };
}

function buildLegacyCompatibilityText(messages = []) {
  const lines = [THREADED_COMPAT_PREAMBLE];
  messages.forEach((message, index) => {
    const label = index === 0 ? 'Comment:' : 'Reply:';
    lines.push(label);
    lines.push(`    ${String(message.text || '').replace(/\r?\n/g, '\n    ')}`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

function emptyCommentsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr"`
    + ` xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision">`
    + `<authors></authors><commentList></commentList></comments>`;
}

function ensureCommentsRootNamespaces(commentsXml = '') {
  let xml = commentsXml;
  if (!/xmlns:xr=/.test(xml)) {
    xml = xml.replace(
      /<comments([^>]*)>/,
      '<comments$1 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
      + ' mc:Ignorable="xr"'
      + ' xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision">'
    );
  }
  return xml;
}

function countAuthors(commentsXml = '') {
  const authorsBlock = /<authors>([\s\S]*?)<\/authors>/.exec(commentsXml);
  if (!authorsBlock) return 0;
  return (authorsBlock[1].match(/<author>/g) || []).length;
}

function stripLegacyCommentsForRef(commentsXml = '', ref = '') {
  const token = escapeXml(String(ref || '').trim());
  if (!token) return commentsXml;
  const pattern = new RegExp(
    `<comment\\s+ref="${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"[\\s\\S]*?</comment>`,
    'g'
  );
  return String(commentsXml || '').replace(pattern, '');
}

function stripThreadedLegacyCommentsForRef(commentsXml = '', ref = '') {
  const token = escapeXml(String(ref || '').trim());
  if (!token) return commentsXml;
  const pattern = new RegExp(
    `<comment\\s+ref="${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"[^>]*xr:uid=[^>]*>[\\s\\S]*?</comment>`,
    'g'
  );
  return String(commentsXml || '').replace(pattern, '');
}

function hasPlainLegacyCommentForRef(commentsXml = '', ref = '') {
  const token = escapeXml(String(ref || '').trim());
  if (!token) return false;
  const pattern = new RegExp(
    `<comment\\s+ref="${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"[^>]*>[\\s\\S]*?</comment>`,
    'g'
  );
  let match = pattern.exec(String(commentsXml || ''));
  while (match) {
    const block = match[0];
    if (!/xr:uid=/.test(block) && !/tc=/.test(block)) return true;
    match = pattern.exec(String(commentsXml || ''));
  }
  return false;
}

function mergeLegacyCommentsXml(commentsXml, threads = []) {
  const originalXml = String(commentsXml || '');
  let workingXml = originalXml;
  let authorCount = countAuthors(workingXml);
  const authorSnippets = [];
  const commentSnippets = [];

  threads.forEach((thread) => {
    const rootId = thread.messages[0]?.id;
    const ref = thread.ref;
    if (!rootId || !ref) return;
    if (workingXml.includes(`xr:uid="${rootId}"`) || workingXml.includes(`tc=${rootId}`)) return;
    workingXml = stripThreadedLegacyCommentsForRef(workingXml, ref);
    if (hasPlainLegacyCommentForRef(workingXml, ref)) {
      return;
    }

    const authorId = authorCount;
    authorCount += 1;
    authorSnippets.push(`<author>tc=${escapeXml(rootId)}</author>`);
    const body = escapeXml(buildLegacyCompatibilityText(thread.messages));
    commentSnippets.push(
      `<comment ref="${escapeXml(ref)}" authorId="${authorId}" xr:uid="${escapeXml(rootId)}">`
      + `<text><t xml:space="preserve">${body}</t></text>`
      + `</comment>`
    );
  });

  if (!authorSnippets.length) {
    return originalXml;
  }

  let xml = ensureCommentsRootNamespaces(workingXml || emptyCommentsXml());
  if (!/<authors>/.test(xml)) {
    xml = xml.replace(/<commentList>/, '<authors></authors><commentList>');
  }
  if (!/<commentList>/.test(xml)) {
    xml = xml.replace(/<\/comments>/, '<commentList></commentList></comments>');
  }
  xml = xml.replace('</authors>', `${authorSnippets.join('')}</authors>`);
  xml = xml.replace('</commentList>', `${commentSnippets.join('')}</commentList>`);
  return xml;
}

function emptyVmlDrawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<xml xmlns:v="urn:schemas-microsoft-com:vml"`
    + ` xmlns:o="urn:schemas-microsoft-com:office:office"`
    + ` xmlns:x="urn:schemas-microsoft-com:office:excel">`
    + `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>`
    + `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202"`
    + ` path="m,l,21600r21600,l21600,xe">`
    + `<v:stroke joinstyle="miter"/>`
    + `<v:path gradientshapeok="t" o:connecttype="rect"/>`
    + `</v:shapetype>`
    + `</xml>`;
}

function nextVmlShapeId(vmlXml = '') {
  let max = 1024;
  const re = /_x0000_s(\d+)/g;
  let match = re.exec(vmlXml);
  while (match) {
    max = Math.max(max, Number(match[1]) || 0);
    match = re.exec(vmlXml);
  }
  return max + 1;
}

const NOTE_VML_WIDTH_PT = 97.8;
const NOTE_VML_HEIGHT_PT = 59.1;
const NOTE_VML_MARGIN_LEFT_PT = 105.3;
const NOTE_VML_MARGIN_TOP_PT = 10.5;
const NOTE_ANCHOR_COL_SPAN = 1;
const NOTE_ANCHOR_ROW_SPAN = 1;

/** ExcelJS default anchor — positions the red corner indicator correctly. */
function buildDefaultVmlAnchor(col1, row1) {
  const l = col1;
  const t = Math.max(row1 - 2, 0);
  return `${l}, 6, ${t}, 14, ${l + 2}, 2, ${t + 4}, 16`;
}

function buildVmlNoteShape({ shapeId, row0, col0 }) {
  const col1 = col0 + 1;
  const row1 = row0 + 1;
  const anchor = buildDefaultVmlAnchor(col1, row1);
  return `<v:shape id="_x0000_s${shapeId}" type="#_x0000_t202"`
    + ` style="position:absolute; margin-left:${NOTE_VML_MARGIN_LEFT_PT}pt;margin-top:${NOTE_VML_MARGIN_TOP_PT}pt;width:${NOTE_VML_WIDTH_PT}pt;height:${NOTE_VML_HEIGHT_PT}pt;z-index:1;visibility:hidden"`
    + ` fillcolor="infoBackground [80]" strokecolor="none [81]" o:insetmode="auto">`
    + `<v:fill color2="infoBackground [80]"/>`
    + `<v:shadow color="none [81]" obscured="t"/>`
    + `<v:path o:connecttype="none"/>`
    + `<v:textbox style="mso-direction-alt:auto" inset="1.3mm,1.3mm,2.5mm,2.5mm"><div style="text-align:left"/></v:textbox>`
    + `<x:ClientData ObjectType="Note">`
    + `<x:MoveWithCells/><x:SizeWithCells/>`
    + `<x:Anchor>${anchor}</x:Anchor>`
    + `<x:Locked>True</x:Locked><x:AutoFill>False</x:AutoFill><x:LockText>True</x:LockText>`
    + `<x:Row>${row0}</x:Row><x:Column>${col0}</x:Column>`
    + `</x:ClientData>`
    + `</v:shape>`;
}

function assignPlainCommentShapeIds(commentsXml = '') {
  let shapeIndex = 0;
  return String(commentsXml).replace(
    /<comment(\s+ref="[A-Z]+\d+")([^>]*)>/g,
    (match, refPart, attrs) => {
      if (/xr:uid=/.test(match)) return match;
      if (/\bshapeId=/.test(attrs)) return match;
      shapeIndex += 1;
      return `<comment${refPart} shapeId="${shapeIndex - 1}"${attrs}>`;
    }
  );
}

function stripCommentShapeIds(commentsXml = '') {
  return String(commentsXml || '').replace(/\s*shapeId="\d+"/g, '');
}

function assignSequentialCommentShapeIds(commentsXml = '') {
  let shapeIndex = nextVmlShapeId(emptyVmlDrawingXml());
  return String(commentsXml).replace(
    /<comment(\s+ref="([A-Z]+\d+)")([^>]*)>/g,
    (match, refPart, ref, attrs) => {
      const cleanAttrs = attrs.replace(/\s*shapeId="\d+"/, '');
      const id = shapeIndex;
      shapeIndex += 1;
      return `<comment${refPart}${cleanAttrs} shapeId="${id}">`;
    }
  );
}

function rebuildVmlFromCommentList(commentsXml = '') {
  let xml = emptyVmlDrawingXml();
  let shapeId = nextVmlShapeId(xml);
  const shapes = [];
  const re = /<comment\s+ref="([A-Z]+\d+)"[^>]*>[\s\S]*?<\/comment>/g;
  let match = re.exec(String(commentsXml || ''));
  while (match) {
    const parsed = parseA1Ref(match[1]);
    if (parsed) {
      shapes.push(buildVmlNoteShape({
        shapeId,
        row0: parsed.row0,
        col0: parsed.col0
      }));
      shapeId += 1;
    }
    match = re.exec(String(commentsXml || ''));
  }
  if (!shapes.length) return xml;
  return xml.replace('</xml>', `${shapes.join('')}</xml>`);
}

/** Keep ExcelJS VML for timing notes; only append shapes for admin threaded bridges. */
function prepareCommentsDrawing(commentsXml = '', existingVml = '', threads = []) {
  if (!commentsXml || !/<comment\s+ref=/.test(commentsXml)) {
    return {
      commentsXml: commentsXml || '',
      vmlXml: existingVml || emptyVmlDrawingXml()
    };
  }
  const withoutShapeIds = stripCommentShapeIds(commentsXml);
  let vmlXml = existingVml && /ObjectType="Note"/.test(existingVml)
    ? existingVml
    : rebuildVmlFromCommentList(withoutShapeIds);
  if (threads.length) {
    vmlXml = mergeLegacyVmlDrawing(vmlXml, threads);
  }
  return { commentsXml: withoutShapeIds, vmlXml };
}

function linkAllCommentShapeIds(commentsXml = '', vmlXml = '') {
  const vmlOrder = [];
  const shapeBlocks = String(vmlXml).match(/<v:shape[\s\S]*?ObjectType="Note"[\s\S]*?<\/v:shape>/g) || [];
  shapeBlocks.forEach((block, index) => {
    const rowMatch = block.match(/<x:Row>(\d+)<\/x:Row><x:Column>(\d+)<\/x:Column>/);
    if (rowMatch) {
      vmlOrder.push({
        row0: Number(rowMatch[1]),
        col0: Number(rowMatch[2]),
        shapeId: index
      });
    }
  });

  return String(commentsXml).replace(
    /<comment(\s+ref="([A-Z]+\d+)")([^>]*)>/g,
    (match, refPart, ref, attrs) => {
      const pos = parseA1Ref(ref);
      if (!pos) return match;
      const shape = vmlOrder.find((entry) => entry.row0 === pos.row0 && entry.col0 === pos.col0);
      if (!shape) return match;
      const cleanAttrs = attrs.replace(/\s*shapeId="\d+"/, '');
      return `<comment${refPart}${cleanAttrs} shapeId="${shape.shapeId}">`;
    }
  );
}

function linkPlainCommentShapeIds(commentsXml = '', vmlXml = '') {
  return linkAllCommentShapeIds(commentsXml, vmlXml);
}

function ensureSheetViewShowsObjects(sheetXml = '') {
  if (!sheetXml) return sheetXml;
  if (/\sshowObjects=/.test(sheetXml)) {
    return sheetXml.replace(/\sshowObjects="[^"]*"/, ' showObjects="all"');
  }
  return sheetXml.replace(/<sheetView([^>]*)>/, '<sheetView$1 showObjects="all">');
}

/** Strip threaded bridge entries — internal helper for plain-note VML only. */
function plainTimingCommentsXml(commentsXml = '') {
  let xml = String(commentsXml || '');
  if (!xml) return xml;

  xml = xml.replace(
    /<comment\s+ref="[A-Z]+\d+"[^>]*xr:uid=[^>]*>[\s\S]*?<\/comment>/g,
    ''
  );
  xml = xml.replace(/<author>tc=[^<]+<\/author>/g, '');

  if (!/xr:uid=/.test(xml)) {
    xml = xml
      .replace(/\s*xmlns:mc="[^"]*"/g, '')
      .replace(/\s*mc:Ignorable="[^"]*"/g, '')
      .replace(/\s*xmlns:xr="[^"]*"/g, '');
  }

  // ExcelJS plain notes omit shapeId; keep that format for indicator compatibility.
  xml = xml.replace(/(<comment\s+ref="[A-Z]+\d+")\s+shapeId="\d+"([^>]*>)/g, '$1$2');

  return xml;
}

function rebuildVmlForPlainComments(commentsXml = '') {
  let xml = emptyVmlDrawingXml();
  let shapeId = nextVmlShapeId(xml);
  const shapes = [];
  const re = /<comment\s+ref="([A-Z]+\d+)"[^>]*>[\s\S]*?<\/comment>/g;
  let match = re.exec(String(commentsXml || ''));
  while (match) {
    const ref = match[1];
    const block = match[0];
    if (!/xr:uid=/.test(block)) {
      const parsed = parseA1Ref(ref);
      if (parsed) {
        shapes.push(buildVmlNoteShape({
          shapeId,
          row0: parsed.row0,
          col0: parsed.col0
        }));
        shapeId += 1;
      }
    }
    match = re.exec(String(commentsXml || ''));
  }
  if (!shapes.length) return xml;
  return xml.replace('</xml>', `${shapes.join('')}</xml>`);
}

function compactVmlNoteAnchors(vmlXml = '') {
  if (!vmlXml) return vmlXml;
  return vmlXml.replace(
    /(<x:ClientData ObjectType="Note">[\s\S]*?<x:Anchor>)([\d,\s]+)(<\/x:Anchor>)/g,
    (match, prefix, anchor, suffix) => {
      const parts = String(anchor).split(',').map((token) => Number(String(token).trim()));
      if (parts.length !== 8 || parts.some((n) => !Number.isFinite(n))) return match;
      const [c1, d1, r1, dn1] = parts;
      const compactAnchor = `${c1}, ${d1}, ${r1}, ${dn1}, ${c1 + 1}, ${d1}, ${r1 + 1}, ${dn1}`;
      return `${prefix}${compactAnchor}${suffix}`;
    }
  );
}

function ensureVmlShapesForPlainComments(commentsXml, vmlXml) {
  let xml = vmlXml || emptyVmlDrawingXml();
  let shapeId = nextVmlShapeId(xml);
  const shapes = [];
  const re = /<comment\s+ref="([A-Z]+\d+)"[^>]*>[\s\S]*?<\/comment>/g;
  let match = re.exec(String(commentsXml || ''));
  while (match) {
    const ref = match[1];
    const block = match[0];
    if (!/xr:uid=/.test(block) && !/tc=/.test(block)) {
      const parsed = parseA1Ref(ref);
      if (parsed) {
        const already = new RegExp(
          `<x:Row>${parsed.row0}</x:Row>\\s*<x:Column>${parsed.col0}</x:Column>`
        );
        if (!already.test(xml)) {
          shapes.push(buildVmlNoteShape({
            shapeId,
            row0: parsed.row0,
            col0: parsed.col0
          }));
          shapeId += 1;
        }
      }
    }
    match = re.exec(String(commentsXml || ''));
  }
  if (!shapes.length) return xml;
  return xml.replace('</xml>', `${shapes.join('')}</xml>`);
}

function finalizeVmlDrawing(commentsXml, existingVml = '', threads = []) {
  let xml = existingVml || emptyVmlDrawingXml();
  xml = ensureVmlShapesForPlainComments(plainTimingCommentsXml(commentsXml), xml);
  if (threads.length) {
    xml = mergeLegacyVmlDrawing(xml, threads);
  }
  if (!existingVml && !/ObjectType="Note"/.test(xml)) {
    return rebuildVmlForPlainComments(plainTimingCommentsXml(commentsXml));
  }
  return xml;
}

function enlargeVmlNoteShapes(vmlXml = '') {
  if (!vmlXml) return vmlXml;
  let xml = vmlXml.replace(
    /width:\s*[\d.]+pt;height:\s*[\d.]+pt/g,
    `width:${NOTE_VML_WIDTH_PT}pt;height:${NOTE_VML_HEIGHT_PT}pt`
  );
  xml = xml.replace(
    /(<x:ClientData ObjectType="Note">[\s\S]*?<x:Anchor>)([\d,\s]+)(<\/x:Anchor>)/g,
    (match, prefix, anchor, suffix) => {
      const parts = String(anchor).split(',').map((token) => Number(String(token).trim()));
      if (parts.length !== 8 || parts.some((n) => !Number.isFinite(n))) return match;
      const [c1, d1, r1, dn1, c2, d2, r2, dn2] = parts;
      const newC2 = Math.max(c2, c1 + NOTE_ANCHOR_COL_SPAN);
      const newR2 = Math.max(r2, r1 + NOTE_ANCHOR_ROW_SPAN);
      return `${prefix}${c1}, ${d1}, ${r1}, ${dn1}, ${newC2}, ${d2}, ${newR2}, ${dn2}${suffix}`;
    }
  );
  return xml.replace(
    /inset="[^"]*"/g,
    'inset="2mm,2mm,2mm,2mm"'
  ).replace(
    /<v:textbox style="([^"]*)"/g,
    (match, style) => {
      const next = style.includes('mso-fit-shape-to-text')
        ? style
        : `${style};mso-fit-shape-to-text:true`;
      return `<v:textbox style="${next}"`;
    }
  );
}

function mergeLegacyVmlDrawing(vmlXml, threads = []) {
  let xml = vmlXml || emptyVmlDrawingXml();
  let shapeId = nextVmlShapeId(xml);
  const shapes = [];

  threads.forEach((thread) => {
    const parsed = parseA1Ref(thread.ref);
    if (!parsed) return;
    const already = new RegExp(
      `<x:Row>${parsed.row0}</x:Row>\\s*<x:Column>${parsed.col0}</x:Column>`
    );
    if (already.test(xml)) return;
    shapes.push(buildVmlNoteShape({
      shapeId,
      row0: parsed.row0,
      col0: parsed.col0
    }));
    shapeId += 1;
  });

  if (!shapes.length) return xml;
  return xml.replace('</xml>', `${shapes.join('')}</xml>`);
}

function ensureSheetLegacyDrawing(sheetXml, vmlRelId) {
  if (!sheetXml || !vmlRelId) return sheetXml;
  if (/<legacyDrawing[\s>]/.test(sheetXml)) {
    return sheetXml.replace(
      /<legacyDrawing[^/]*\/>/,
      `<legacyDrawing r:id="${vmlRelId}"/>`
    );
  }
  return sheetXml.replace(
    '</worksheet>',
    `<legacyDrawing r:id="${vmlRelId}"/></worksheet>`
  );
}

/**
 * Inject Office threaded-comment parts into an ExcelJS-written XLSX buffer,
 * including the legacy comments.xml + VML bridge Excel needs to display them.
 * @param {Buffer} buffer
 * @param {Array<{ ref: string, messages: Array }>} cellThreads
 * @returns {Promise<Buffer>}
 */
async function injectThreadedComments(buffer, cellThreads = []) {
  const { persons, threads } = resolvePersonsAndThreads(cellThreads);
  const zip = await JSZip.loadAsync(buffer);
  const commentsPath = 'xl/comments1.xml';
  const vmlPath = 'xl/drawings/vmlDrawing1.vml';
  const existingComments = zip.file(commentsPath)
    ? await zip.file(commentsPath).async('string')
    : '';
  const existingVml = zip.file(vmlPath)
    ? await zip.file(vmlPath).async('string')
    : '';

  const mergedCommentsXml = threads.length
    ? mergeLegacyCommentsXml(existingComments, threads)
    : existingComments;
  const prepared = prepareCommentsDrawing(mergedCommentsXml, existingVml, threads);
  const linkedCommentsXml = prepared.commentsXml;
  const finalizedVml = prepared.vmlXml;
  if (linkedCommentsXml) {
    zip.file(commentsPath, linkedCommentsXml);
  }
  zip.file(vmlPath, finalizedVml);

  if (!threads.length) {
    const sheetRelsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
    const sheetRelsFile = zip.file(sheetRelsPath);
    if (sheetRelsFile) {
      const sheetRelsXml = await sheetRelsFile.async('string');
      const vmlRelId = findRelationshipId(sheetRelsXml, {
        type: VML_REL_TYPE,
        target: '../drawings/vmlDrawing1.vml'
      });
      const sheetPath = 'xl/worksheets/sheet1.xml';
      const sheetXml = await zip.file(sheetPath).async('string');
      zip.file(
        sheetPath,
        ensureSheetViewShowsObjects(ensureSheetLegacyDrawing(sheetXml, vmlRelId))
      );
    }
    const out = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });
    return Buffer.from(out);
  }

  zip.file('xl/persons/person.xml', buildPersonListXml(persons));
  zip.file('xl/threadedComments/threadedComment1.xml', buildThreadedCommentsXml(threads));

  const contentTypesPath = '[Content_Types].xml';
  let contentTypesXml = await zip.file(contentTypesPath).async('string');
  contentTypesXml = ensureContentTypeDefault(contentTypesXml, {
    extension: 'vml',
    contentType: VML_CONTENT_TYPE
  });
  contentTypesXml = ensureContentTypeOverride(contentTypesXml, {
    partName: '/xl/persons/person.xml',
    contentType: PERSON_CONTENT_TYPE
  });
  contentTypesXml = ensureContentTypeOverride(contentTypesXml, {
    partName: '/xl/threadedComments/threadedComment1.xml',
    contentType: THREADED_COMMENT_CONTENT_TYPE
  });
  contentTypesXml = ensureContentTypeOverride(contentTypesXml, {
    partName: '/xl/comments1.xml',
    contentType: COMMENTS_CONTENT_TYPE
  });
  zip.file(contentTypesPath, contentTypesXml);

  const workbookRelsPath = 'xl/_rels/workbook.xml.rels';
  const workbookRelsXml = await zip.file(workbookRelsPath).async('string');
  zip.file(workbookRelsPath, ensureRelationship(workbookRelsXml, {
    type: PERSON_REL_TYPE,
    target: 'persons/person.xml'
  }));

  const sheetRelsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  const sheetRelsFile = zip.file(sheetRelsPath);
  let sheetRelsXml = sheetRelsFile
    ? await sheetRelsFile.async('string')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  sheetRelsXml = ensureRelationship(sheetRelsXml, {
    type: COMMENTS_REL_TYPE,
    target: '../comments1.xml'
  });
  sheetRelsXml = ensureRelationship(sheetRelsXml, {
    type: VML_REL_TYPE,
    target: '../drawings/vmlDrawing1.vml'
  });
  sheetRelsXml = ensureRelationship(sheetRelsXml, {
    type: THREADED_COMMENT_REL_TYPE,
    target: '../threadedComments/threadedComment1.xml'
  });
  zip.file(sheetRelsPath, sheetRelsXml);

  const vmlRelId = findRelationshipId(sheetRelsXml, {
    type: VML_REL_TYPE,
    target: '../drawings/vmlDrawing1.vml'
  });
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheetXml = await zip.file(sheetPath).async('string');
  zip.file(sheetPath, ensureSheetViewShowsObjects(ensureSheetLegacyDrawing(sheetXml, vmlRelId)));

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });
  return Buffer.from(out);
}

module.exports = {
  PERSON_CONTENT_TYPE,
  THREADED_COMMENT_CONTENT_TYPE,
  personKey,
  escapeXml,
  parseA1Ref,
  buildLegacyCompatibilityText,
  mergeLegacyCommentsXml,
  mergeLegacyVmlDrawing,
  compactVmlNoteAnchors,
  ensureVmlShapesForPlainComments,
  finalizePlainCommentsXml: plainTimingCommentsXml,
  stripCommentShapeIds,
  assignSequentialCommentShapeIds,
  rebuildVmlFromCommentList,
  prepareCommentsDrawing,
  linkAllCommentShapeIds,
  linkPlainCommentShapeIds,
  ensureSheetViewShowsObjects,
  rebuildVmlForPlainComments,
  finalizeVmlDrawing,
  resolvePersonsAndThreads,
  buildPersonListXml,
  buildThreadedCommentsXml,
  injectThreadedComments,
  enlargeVmlNoteShapes,
  NOTE_VML_WIDTH_PT,
  NOTE_VML_HEIGHT_PT
};
