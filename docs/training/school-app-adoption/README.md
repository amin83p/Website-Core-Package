# School app adoption training

Materials for a **~45–60 minute** session: why the school uses the app, why we migrated, how it helps teachers/staff/managers, and the **daily teacher workflow** (Schedule Overview → Manage Session → Save).

## Files

| File | Purpose |
|------|---------|
| [School-App-Adoption-Training.pptx](./School-App-Adoption-Training.pptx) | 25-slide deck (16:9) with speaker notes |
| [School-App-Adoption-Handout.pdf](./School-App-Adoption-Handout.pdf) | Teacher daily checklist (matches slide 25) |
| [screenshots/](./screenshots/) | Sixteen images embedded in the deck |
| [screenshot-manifest.json](./screenshot-manifest.json) | Filenames, slide mapping, routes, capture state |
| [build_school_app_adoption_deck.py](./build_school_app_adoption_deck.py) | Regenerates deck, handout, and placeholder PNGs |

**Quick refresher:** the shorter [teacher daily deck](../teacher-daily-app/Teacher-Daily-App-Training.pptx) (14 slides) covers only Schedule Overview → Save.

## Suggested session flow

1. **Why the app** (slides 2–5) — ~10 min  
2. **Migration + audiences** (slides 6–11) — ~10 min  
3. **Daily walkthrough** (slides 12–24) — ~25–35 min  
4. **Checklist + Q&A** (slide 25) — ~5 min  

## Replace placeholders with your screenshots

1. Log in as a teacher (or demo account with realistic data).
2. Capture the sixteen shots below (blur student names on rosters).
3. Save each file under `screenshots/` using the **exact filename** from the manifest.
4. Run:

```bash
python docs/training/school-app-adoption/build_school_app_adoption_deck.py
```

Files larger than ~50 KB are treated as real screenshots and are **not** overwritten on rebuild.

## Prioritized capture list

Do these first for a usable deck; items marked **needs data** require assignments, books, cases, or gradebook entries in your environment.

| Priority | File | Slide | Route | State to capture |
|----------|------|-------|-------|------------------|
| P1 | `01-dashboard-open-my-schedule.png` | 13 | School section dashboard | My Schedule Overview + **Open My Schedule** |
| P1 | `02-schedule-overview-full.png` | 14 | `/school/schedules/my` | After **Load**, table visible |
| P1 | `03-filters-anchor-period-load.png` | 14 | `/school/schedules/my` | Anchor Date, period, **Load** |
| P1 | `04-session-details-table.png` | 15 | `/school/schedules/my` | Your sessions with Status / Role |
| P1 | `05-open-manage-session.png` | 16 | `/school/classes/{classId}/sessions/{sessionId}` | Manage Session header |
| P1 | `06-manage-session-map.png` | 16 | same | Sidebar + **Save session** + status |
| P1 | `07-attendance-panel.png` | 17 | same | **Attendance** panel (blur names) |
| P1 | `08-session-notes.png` | 18 | same | **Session & notes** |
| P2 | `14-session-status-picker.png` | 23 | same | Status = **Completed** |
| P2 | `15-save-session.png` | 24 | same | After **Save session** |
| P2 | `16-verify-schedule-overview.png` | 24 | `/school/schedules/my` | Row shows **Completed** |
| P3 **needs data** | `09-reports-panel.png` | 19 | Manage Session | **Reports** with an assignment |
| P3 **needs data** | `10-book-coverage.png` | 20 | Manage Session | **Book coverage** entry |
| P3 **needs data** | `11-student-cases.png` | 21 | Manage Session | **Student Cases** |
| P3 **needs data** | `12-class-conduct.png` | 21 | Manage Session | **Class Conduct** |
| P3 **needs data** | `13-gradebook-activities.png` | 22 | Manage Session | **Grade book** activities |

If a P3 panel is unused at your school, keep the placeholder or capture the empty panel and say in training that the section is optional.

**Ask for help:** If you need a specific UI state (e.g. Reports with a pending badge), note the manifest `file` name and we can confirm the exact screen to capture.

## Customize branding

Edit top of `screenshot-manifest.json`:

- `schoolName` — title slide and handout header  
- `completedStatusLabel` — should match your org ([`data/school/sessionStatuses.json`](../../../data/school/sessionStatuses.json))  
- `supportContact` — slide 25 and handout footer  

Or edit accent/footer in `build_school_app_adoption_deck.py` and rebuild.

## Privacy

Blur or redact student names on attendance and case screenshots before distributing the deck.
