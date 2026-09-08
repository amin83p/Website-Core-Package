#!/usr/bin/env python3
"""Generate Student Case Operation and Scope Capabilities Word document from markdown."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / 'scripts' / 'design_docs' / 'generate_design_doc_docx.py'
INPUT_MD = ROOT / 'docs' / 'design_docs' / 'student-case-operation-scope-capabilities-2026-09-06.md'
OUTPUT_DOCX = ROOT / 'docs' / 'design_docs' / 'student-case-operation-scope-capabilities-2026-09-06.docx'


def main() -> int:
    if not GENERATOR.exists():
        raise FileNotFoundError(f'Missing generator: {GENERATOR}')
    if not INPUT_MD.exists():
        raise FileNotFoundError(f'Missing markdown source: {INPUT_MD}')

    cmd = [sys.executable, str(GENERATOR), str(INPUT_MD), str(OUTPUT_DOCX)]
    subprocess.check_call(cmd)
    print(f'Generated: {OUTPUT_DOCX}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
