# Book TOC imports (Gemini / structured JSON)

Place one source file per book (same shape as `basic-tactics-for-listening.json`), then run:

```bash
node scripts/school/apply-book-toc-from-source.js data/school/book-toc-sources/<your-file>.json
```

The script uses the **active data backend** (`DATA_BACKEND`, usually Mongo in dev/prod). Books are matched by **title** across the catalog, or by id when you pass `BK-…` as the second argument.

If title match fails, pass the book id:

```bash
node scripts/school/apply-book-toc-from-source.js data/school/book-toc-sources/<your-file>.json BK-2026-XXXXXX
```

The script always writes a flat `tableOfContents` export under `data/school/book-toc-imports/` for review or manual paste into the book form **Table of contents** tab.
