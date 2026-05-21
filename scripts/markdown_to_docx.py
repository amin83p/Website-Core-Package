#!/usr/bin/env python3
"""
Small local Markdown -> DOCX converter.
Supports:
- #, ##, ### headings
- paragraphs
- ordered list lines ("1. item") as plain text
- unordered list lines ("- item") prefixed with "-"
- fenced code blocks as monospace paragraphs

Usage:
  python scripts/markdown_to_docx.py input.md output.docx
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


def _clean_text(value: str) -> str:
    out = []
    for ch in value:
        code = ord(ch)
        if ch in ("\t", "\n", "\r"):
            out.append(ch)
        elif code >= 32:
            out.append(ch)
    return "".join(out)


def _w_p(text: str, style: str | None = None, preserve_space: bool = False) -> str:
    text = _clean_text(text)
    style_xml = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>" if style else ""
    needs_preserve = preserve_space or text.startswith(" ") or text.endswith(" ") or "  " in text
    t_attr = " xml:space=\"preserve\"" if needs_preserve else ""
    return f"<w:p>{style_xml}<w:r><w:t{t_attr}>{escape(text)}</w:t></w:r></w:p>"


def _markdown_to_paragraphs(md_text: str) -> list[str]:
    lines = md_text.splitlines()
    paragraphs: list[str] = []
    in_code = False

    for raw_line in lines:
        line = raw_line.rstrip("\n")
        stripped = line.strip()

        if stripped.startswith("```"):
            in_code = not in_code
            if not in_code:
                paragraphs.append(_w_p(""))
            continue

        if in_code:
            paragraphs.append(_w_p(line, style="Code", preserve_space=True))
            continue

        if stripped == "":
            paragraphs.append(_w_p(""))
            continue

        if line.startswith("# "):
            paragraphs.append(_w_p(line[2:].strip(), style="Heading1"))
            continue
        if line.startswith("## "):
            paragraphs.append(_w_p(line[3:].strip(), style="Heading2"))
            continue
        if line.startswith("### "):
            paragraphs.append(_w_p(line[4:].strip(), style="Heading3"))
            continue

        if re.match(r"^\d+\.\s+", stripped):
            paragraphs.append(_w_p(stripped))
            continue

        if stripped.startswith("- "):
            paragraphs.append(_w_p(f"- {stripped[2:].strip()}"))
            continue

        # Keep markdown tables and other lines as plain text.
        paragraphs.append(_w_p(line))

    return paragraphs


def _document_xml(paragraphs: list[str]) -> str:
    body = "".join(paragraphs)
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document "
        "xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" "
        "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" "
        "xmlns:o=\"urn:schemas-microsoft-com:office:office\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" "
        "xmlns:v=\"urn:schemas-microsoft-com:vml\" "
        "xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" "
        "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" "
        "xmlns:w10=\"urn:schemas-microsoft-com:office:word\" "
        "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
        "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" "
        "xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" "
        "xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" "
        "xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" "
        "xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" "
        "xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" "
        "mc:Ignorable=\"w14 w15 wp14\">"
        f"<w:body>{body}"
        "<w:sectPr>"
        "<w:pgSz w:w=\"12240\" w:h=\"15840\"/>"
        "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>"
        "<w:cols w:space=\"720\"/>"
        "<w:docGrid w:linePitch=\"360\"/>"
        "</w:sectPr>"
        "</w:body></w:document>"
    )


def _styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr/></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>
"""


def _content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""


def _root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def _document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"""


def convert_markdown_to_docx(input_md: Path, output_docx: Path) -> None:
    md_text = input_md.read_text(encoding="utf-8")
    paragraphs = _markdown_to_paragraphs(md_text)

    output_docx.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_docx, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _content_types_xml())
        zf.writestr("_rels/.rels", _root_rels_xml())
        zf.writestr("word/document.xml", _document_xml(paragraphs))
        zf.writestr("word/styles.xml", _styles_xml())
        zf.writestr("word/_rels/document.xml.rels", _document_rels_xml())


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python scripts/markdown_to_docx.py <input.md> <output.docx>")
        return 1

    input_md = Path(sys.argv[1]).resolve()
    output_docx = Path(sys.argv[2]).resolve()

    if not input_md.exists():
        print(f"Input file does not exist: {input_md}")
        return 2

    convert_markdown_to_docx(input_md, output_docx)
    print(f"Created: {output_docx}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

