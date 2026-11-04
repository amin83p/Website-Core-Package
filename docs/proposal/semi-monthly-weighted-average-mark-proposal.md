# Proposal: Weighted Average Mark on Semi-Monthly Progress Reports

**Audience:** Office / academic leadership  
**Purpose:** Align the headline **Average Class Mark** with school priorities—especially **attendance**, which carries the **heaviest weight** in our proposed model—instead of treating all eight rubric lines equally.  
**Status:** Discussion document only. No product changes until leadership approves weights and a calculation model.

---

## 1. What “average mark” means today

Semi-monthly progress reports use templates such as the **Two-Week Progress Report**. The field **Average Class Mark (Auto Calculation)** is **not** taken from the gradebook. It adds eight rubric scores and divides by **8**, so each line counts **12.5%**:

`(Attendance + Punctuality + Respects Teachers + Returns Assignments + Treats Students + Writes Tests + Class Effort + Class Participation) ÷ 8`

Most of those values are entered manually on the report. They do not automatically use attendance matrix data, session conduct ratings, or gradebook/exam averages.

**Why this matters:** A student can have weak attendance but strong conduct scores on the form. Under equal weighting, attendance counts the same as participation—**not** the same as our stated priority that **attendance is the heaviest factor** in how we judge progress.

---

## 2. What the system already calculates (not wired to Average Class Mark)

| Source | Weighting in the app today | Used in Average Class Mark? |
|--------|----------------------------|-----------------------------|
| Period gradebook average | Weighted by activity points/weights in Session Manager | No |
| Per-skill gradebook averages | Weighted within each skill | No |
| Exam period average | Simple mean of exam percentages | No |
| Session conduct ratings (period span) | Mean across sessions | No |
| Template formula (eight rubric fields) | **Equal 12.5% each** | **Yes (funder-facing headline)** |

Teachers already set **weight** and **total points** on gradebook activities. That logic does not flow into Average Class Mark until policy and templates connect it.

---

## 3. External practice (brief)

Learning-management gradebooks distinguish **mean of grades** (every item’s percent counts equally) from **weighted mean** (each item has an explicit share of the total). Fair programs **publish the weight table** and align it with handbook/syllabus language. See Moodle grade aggregation, Monash “Weighted mean of grades,” and similar university guidance.

---

## 4. Proposed direction for Equilibrium (attendance heaviest)

### Recommended Model 1 for office discussion — weighted rubric

Keep the same eight report fields, but assign **policy weights that sum to 100%**. **Attendance has the largest single weight**, reflecting school priority. Illustrative starting point for discussion:

| Rubric field | Proposed weight % | Notes |
|--------------|------------------:|-------|
| **Attendance** | **25** | **Heaviest weight (school priority)** |
| Punctuality | 15 | Second emphasis; supports attendance culture |
| Writes tests on time | 12 | Academic / compliance |
| Class effort | 12 | Engagement |
| Class participation | 12 | Engagement |
| Returns assignments on time | 8 | Academic |
| Respects the teachers | 8 | Conduct |
| Treats other students with respect | 8 | Conduct |
| **Total** | **100** | |

Leadership may adjust numbers; the principle is **attendance ≥ any other single line** and weights are **published** before we change the template formula.

### Other models (if the office prefers)

- **Gradebook-forward:** headline = period gradebook average only; attendance shown separately (not blended into one number unless policy says so).
- **Hybrid:** e.g. 40% academic block (gradebook + exams) + 60% professionalism block where **attendance still dominates** inside the professionalism block.

### Phased implementation (after approval only)

1. **Policy** — approve weights and missing-value rules (see section 6).  
2. **Template & optional settings** — weighted formula; optional prefill from attendance/punctuality/conduct/gradebook catalog fields.  
3. **Engine** — weighted-average helper in report formulas if needed.

---

## 5. Worked examples — equal weight vs attendance-heavy weight

All examples use the **same rubric scores** on the report. Only the **formula** changes.

**Formula A (today):** sum of eight scores ÷ 8  

**Formula B (proposed illustration):**  
`(25×Attendance + 15×Punctuality + 12×Writes_Tests + 12×Effort + 12×Participation + 8×Returns + 8×Respects + 8×Treats) ÷ 100`  

Missing or blank lines are treated as **0** in these illustrations (same as today’s calculator behavior when fields are empty).

### Example 1 — Weak attendance, strong conduct (realistic semi-monthly case)

| Field | Score (0–100) |
|-------|---------------:|
| Attendance | 31 |
| Punctuality | 0 |
| Returns assignments | — (0) |
| Writes tests | — (0) |
| Respects teachers | 100 |
| Treats students | 100 |
| Class effort | 100 |
| Class participation | 100 |

| Method | Average Class Mark |
|--------|-------------------:|
| **A — Equal weight (today)** | **54** |
| **B — Attendance heaviest** | **48** |

**Effect:** Strong conduct no longer fully offsets poor attendance. The headline mark drops **6 points**, which matches the message that **attendance is the heaviest factor**.

### Example 2 — Strong attendance and punctuality, moderate academics

| Field | Score |
|-------|------:|
| Attendance | 95 |
| Punctuality | 92 |
| Returns assignments | 78 |
| Writes tests | 80 |
| Respects teachers | 85 |
| Treats students | 88 |
| Class effort | 86 |
| Class participation | 90 |

| Method | Average Class Mark |
|--------|-------------------:|
| **A — Equal weight** | **86.8** → **87** |
| **B — Attendance heaviest** | **88.0** → **88** |

**Effect:** Students who attend reliably gain **about 1 point** on the headline mark versus equal weighting—rewarding the behaviour the school prioritises.

### Example 3 — Perfect attendance record but weak test/assignment scores

| Field | Score |
|-------|------:|
| Attendance | 100 |
| Punctuality | 100 |
| Returns assignments | 50 |
| Writes tests | 50 |
| Respects teachers | 70 |
| Treats students | 70 |
| Class effort | 70 |
| Class participation | 70 |

| Method | Average Class Mark |
|--------|-------------------:|
| **A — Equal weight** | **77.5** → **78** |
| **B — Attendance heaviest** | **78.0** → **78** |

**Effect:** Perfect attendance **pulls the mark up slightly** compared with equal weighting, but **does not** hide weak academic lines—tests and assignments still matter under the proposed weights.

### Example 4 — Side-by-side summary (same student as Example 1)

| | Equal 12.5% each | Attendance 25% (proposed) |
|--|------------------:|-------------------------:|
| Attendance contribution to total | 3.9 | 7.8 |
| Punctuality contribution | 0.0 | 0.0 |
| Six “100” conduct/effort lines | 75.0 | 40.0 |
| **Average Class Mark** | **54** | **48** |

Attendance’s share of the calculation **doubles** relative to any single conduct line (25% vs 12.5%), which is why low attendance has a **stronger downward pull** on the headline mark.

---

## 6. Decisions needed from the office

| Question | Options |
|----------|---------|
| Confirm **attendance as heaviest weight** (e.g. 25%) and approve other weights | Adjust table in section 4 |
| Include conduct/attendance in **one** headline mark vs separate academic score | Composite / separate columns |
| Fixed policy weights vs teacher override per class | Policy-only / optional override |
| Data source for rubric lines | Manual / prefill from system / both |
| Missing values (e.g. punctuality 0) | Count as zero / exclude from denominator / block export |

---

## 7. Success criteria

- Published weight table (with **attendance listed as heaviest**) matches what the system calculates.
- Teachers and funders can explain a student’s mark in one sentence, e.g. “Attendance is 25% of the average; the rest is punctuality, academics, and conduct.”
- Semi-monthly reports reflect **school priority on attendance** without hiding academic or conduct problems entirely.

---

**Next step:** Office confirms weights (especially **attendance ≥ all other single fields**), then development can update the report template and optional school settings—**only after approval**.
