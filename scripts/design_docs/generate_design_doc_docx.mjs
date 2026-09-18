/**
 * Node fallback for generate_design_doc_docx.py when Python/python-docx is unavailable.
 * Usage: node scripts/design_docs/generate_design_doc_docx.mjs <input.md> [output.docx]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseTableRow(line) {
  const stripped = line.trim();
  if (!stripped.startsWith('|')) return null;
  return stripped.slice(1, -1).split('|').map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function parseMarkdownBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();
    if (!stripped) {
      i += 1;
      continue;
    }
    if (stripped === '---') {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }
    if (stripped.startsWith('```')) {
      i += 1;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', text: codeLines.join('\n').replace(/\s+$/, '') });
      continue;
    }
    if (stripped.startsWith('#')) {
      const level = stripped.length - stripped.replace(/^#+/, '').length;
      const text = stripped.slice(level).trim();
      blocks.push({ type: 'heading', level: Math.min(level, 3), text });
      i += 1;
      continue;
    }
    if (stripped.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const parsed = tableLines.map(parseTableRow).filter(Boolean);
      if (parsed.length) {
        let dataRows = parsed.slice(1);
        if (dataRows.length && isSeparatorRow(dataRows[0])) dataRows = dataRows.slice(1);
        blocks.push({ type: 'table', headers: parsed[0], rows: dataRows });
      }
      continue;
    }
    if (stripped.startsWith('- ') || stripped.startsWith('* ')) {
      const items = [];
      while (i < lines.length) {
        const itemLine = lines[i].trim();
        if (itemLine.startsWith('- ') || itemLine.startsWith('* ')) {
          items.push(itemLine.slice(2).trim());
          i += 1;
        } else if (itemLine.startsWith('- ') || /^[*]\s/.test(itemLine)) {
          items.push(itemLine.replace(/^[-*]\s+/, '').trim());
          i += 1;
        } else if (itemLine.startsWith('- ') === false && (itemLine.startsWith('  - ') || itemLine.startsWith('  * '))) {
          items.push(`  ${itemLine.trim().slice(2).trim()}`);
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    const paraLines = [stripped];
    i += 1;
    while (i < lines.length) {
      const nxt = lines[i].trim();
      if (!nxt || nxt.startsWith('#') || nxt.startsWith('|') || nxt.startsWith('```') || nxt === '---' || nxt.startsWith('- ') || nxt.startsWith('* ')) break;
      paraLines.push(nxt);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }
  return blocks;
}

function textRunsFromMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return new TextRun({ text: part.slice(2, -2), bold: true });
    }
    return new TextRun({ text: part });
  });
}

function paragraphFromMarkdown(text, options = {}) {
  return new Paragraph({ children: textRunsFromMarkdown(text), ...options });
}

function headingLevel(level) {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function renderBlocks(blocks) {
  const children = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(paragraphFromMarkdown(block.text, { heading: headingLevel(block.level) }));
    } else if (block.type === 'paragraph') {
      children.push(paragraphFromMarkdown(block.text));
    } else if (block.type === 'hr') {
      children.push(new Paragraph({ text: '' }));
    } else if (block.type === 'code') {
      for (const codeLine of (block.text || '').split('\n')) {
        children.push(new Paragraph({ children: [new TextRun({ text: codeLine, font: 'Consolas' })] }));
      }
    } else if (block.type === 'list') {
      for (const item of block.items) {
        const indent = item.startsWith('  ') ? { left: 720 } : {};
        children.push(new Paragraph({
          children: textRunsFromMarkdown(item.trim()),
          bullet: { level: item.startsWith('  ') ? 1 : 0 },
          ...indent
        }));
      }
    } else if (block.type === 'table') {
      const colCount = Math.max(block.headers.length, ...block.rows.map((r) => r.length), 1);
      const pad = (row) => {
        const padded = row.slice(0, colCount);
        while (padded.length < colCount) padded.push('');
        return padded;
      };
      const rows = [pad(block.headers), ...block.rows.map(pad)];
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map((row, ri) => new TableRow({
          children: row.map((cell) => new TableCell({
            children: [new Paragraph({
              children: ri === 0
                ? [new TextRun({ text: cell, bold: true })]
                : textRunsFromMarkdown(cell)
            })]
          }))
        }))
      }));
      children.push(new Paragraph({ text: '' }));
    }
  }
  return children;
}

async function main() {
  const inputArg = process.argv[2];
  const outputArg = process.argv[3];
  if (!inputArg) {
    console.error('Usage: node generate_design_doc_docx.mjs <input.md> [output.docx]');
    process.exit(1);
  }
  const inputPath = path.isAbsolute(inputArg) ? inputArg : path.join(ROOT, inputArg);
  const outputPath = outputArg
    ? (path.isAbsolute(outputArg) ? outputArg : path.join(ROOT, outputArg))
    : inputPath.replace(/\.md$/i, '.docx');

  const text = fs.readFileSync(inputPath, 'utf8');
  const blocks = parseMarkdownBlocks(text.split(/\r?\n/));
  const doc = new Document({ sections: [{ children: renderBlocks(blocks) }] });
  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  console.log(`Generated: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
