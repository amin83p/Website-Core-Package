# Teacher daily app training (Schedule Overview)

Materials for a short teacher training session on the daily workflow: **Schedule Overview → Manage Session → Save**.

## Files

| File | Purpose |
|------|---------|
| [Teacher-Daily-App-Training.pptx](./Teacher-Daily-App-Training.pptx) | 14-slide deck (widescreen 16:9) with speaker notes |
| [Teacher-Daily-App-Handout.pdf](./Teacher-Daily-App-Handout.pdf) | One-page recap (matches slide 14) |
| [screenshots/](./screenshots/) | Eleven images embedded in the deck |
| [screenshot-manifest.json](./screenshot-manifest.json) | Filenames, slide mapping, completed status label |
| [build_teacher_training_deck.py](./build_teacher_training_deck.py) | Regenerates deck and handout after you swap screenshots |

## Replace placeholders with your screenshots

1. Log into your school app as a teacher (or demo account).
2. Capture the eleven shots listed in `screenshot-manifest.json` (blur student names where needed).
3. Save each capture **using the exact filename** in `screenshots/` (overwrite the placeholder PNG).
4. Run:

```bash
python docs/training/teacher-daily-app/build_teacher_training_deck.py
```

Files larger than ~50 KB are treated as real screenshots and are not overwritten on rebuild.

## Session status label

The deck uses **Completed** from your org data ([`data/school/sessionStatuses.json`](../../../data/school/sessionStatuses.json)). To change it, edit `completedStatusLabel` in `screenshot-manifest.json` and rebuild.

## Customize branding

Edit `build_teacher_training_deck.py` (accent color, footer text, school name on slide 1) and rebuild, or adjust fonts and colors directly in PowerPoint after generation.
