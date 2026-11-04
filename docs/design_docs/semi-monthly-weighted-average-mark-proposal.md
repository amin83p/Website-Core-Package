# Proposal: Weighted “Average Mark” on Semi-Monthly Progress Reports

**Audience:** Office / academic leadership  
**Purpose:** Align the headline average with how teachers and funders think about importance (exams vs quizzes vs conduct vs attendance)—not treat every line item as equally important unless that is an explicit policy choice.  
**Status:** Discussion only — no product changes until leadership approves a model and weights.

---

## 1. What we mean by “average mark” today

Semi-monthly reports use **report templates** (seed example: `data/school/reportTemplates.json`, title **“Two-Week Progress Report”**). The visible **Average Class Mark (Auto Calculation)** is **not** pulled from the gradebook. It is a **calculated field** that divides the sum of **eight** rubric scores by **8**—each dimension gets **12.5%** weight:

```text
(Attendance + Punctuality + Respects_The_Teachers + Returns_Assignments
 + Treats_Other_Students + Writes_Tests + classEffort + Class_Participation) / 8
```

Those eight inputs are mostly **manual** on the report (no prefill to gradebook or session metrics in the seed template). Attendance, punctuality, tests, assignments, conduct, effort, and participation therefore **do not automatically reflect** activity point totals or session-level weights teachers set in Session Manager.

**Illustrative effect:** with Attendance ≈ 31, Punctuality = 0, and several conduct/effort fields at 100, the formula yields **54**—because punctuality and attendance count the same as effort, even when academic work might be weighted higher in syllabus or gradebook practice.

**Current flow (conceptual):**

- Eight rubric fields → equal 12.5% each → **Average Class Mark** (what funders often see).
- Separately available in the system but **not** wired to that headline: period gradebook avg, per-skill avgs, exam period avg, session conduct span metrics.

---

## 2. What the application already calculates (audit)

| Source | Prefill / logic | Weighting today | Used in template “Average Class Mark”? |
|--------|-----------------|-----------------|----------------------------------------|
| Session gradebook (period) | `student_gradebook_period_avg_percent` | **Activity-weighted** (`gradebookWeightService`, activity `weight` / `totalScore`) | No |
| Per-skill gradebook | `student_gradebook_skill_{skill}_avg_percent` | Weighted **within skill** across tagged activities | No |
| Exams in period | `student_exam_period_avg_percent` | **Simple mean** of exam percentages | No |
| Session conduct ratings (span) | `student_session_rating_span_*_percent` | **Simple mean across sessions** | No (fields not linked) |
| Template formula | `Average_Class_Mark` | **Equal 1/8 per rubric field** | Yes |

**Teacher tooling:** Session Manager already stores **weight** and **total points** per gradebook activity. That weighting **does not flow** into `Average_Class_Mark` until templates or policy connect it.

**Formula engine:** Report calculated fields support helpers such as `avg(...)` as an **unweighted** mean—appropriate only when each argument should count equally.

---

## 3. Why equal weight is often questioned (external practice)

Common LMS gradebook guidance ([Moodle grade aggregation](https://docs.moodle.org/35/en/Grade_aggregation), [Monash weighted mean](https://www.monash.edu/learning-teaching/teachhq/moodle/gradebook/how-to/weighting-aggregation), [UAlberta course total](https://support.eclass.ualberta.ca/Knowledgebase/Article/View/152/15/calculating-your-course-total)) distinguishes:

- **Mean of grades:** each item’s **percentage** counts equally (many small quizzes can dominate)—similar to our **8-field / exam-mean** patterns.
- **Weighted mean:** each item has an explicit **weight** or **max points** reflecting syllabus importance—similar to our **gradebook period avg** when teachers set weights.
- **Simple weighted mean:** weight = max points (when “Assignment 1 out of 20 = 20% of course”).

Best practice for fairness and transparency: **publish the breakdown**, use **category weights** (academic vs conduct vs attendance), and avoid mixing many **formative** items with **summative** exams unless weights say so ([USC CTE grading considerations](https://environmental.sc.edu/about/offices_and_divisions/cte/teaching_resources/course_design_development_delivery/grading_assessment_toolbox/other_considerations/index.php)).

---

## 4. Recommended direction (phased, low risk)

### Phase A — Policy (office, no code)

Decide the **definition** of “Average Class Mark” for semi-monthly / funder reports:

1. **Composite rubric average:** eight (or N) dimensions with **explicit weights** (e.g. academic 50%, conduct 30%, attendance/punctuality 20%)—not necessarily 12.5% each.
2. **Gradebook-forward:** headline = period gradebook average (points-weighted activities); conduct/attendance as separate columns only.
3. **Hybrid:** e.g. 60% academic block (gradebook + exams) + 40% professionalism block (conduct/attendance/punctuality), with weights documented in policy.

Document weights in the **student handbook / syllabus** and on the report footer so scores are defensible.

### Phase B — Template & settings (after approval)

- Update **Two-Week Progress Report** (and copies): replace `/8` with a **weighted** formula once weights are approved.
- Optionally **prefill** rubric fields from existing report prefill catalog (attendance span %, punctuality span %, session rating span, gradebook/exam averages).
- Optionally add **semi-monthly school settings** for default category weights so templates are not hard-coded.

### Phase C — Engine improvements (if needed)

- Add a **weighted average** helper in the report formula engine.
- Optional **points-weighted** exam period average when exam max scores differ widely.
- Clarify catalog text for skill `avg_percent` (implementation can be weight-aware when activity weights differ).

---

## 5. Example weight models (for discussion)

**Model 1 — Weighted rubric (minimal change)**  
Keep eight fields; example weights summing to 100:

`(15×Attendance + 10×Punctuality + 10×Returns + 15×Writes_Tests + 10×Respects + 10×Treats + 15×Effort + 15×Participation) / 100`

**Model 2 — Two-tier (LMS-style categories)**  
- **Academic block (60%):** blend of `student_gradebook_period_avg_percent` and `student_exam_period_avg_percent`.  
- **Professionalism block (40%):** weighted conduct/attendance/punctuality (prefilled where possible).

**Model 3 — Activity-native**  
Headline = gradebook weighted average only; conduct and attendance as **separate** report columns unless policy caps their influence (e.g. attendance max 10% of a composite).

---

## 6. Decisions needed from the office

| Question | Options |
|----------|---------|
| Should **Average Class Mark** include **conduct/attendance**, or stay **academic-only**? | Academic-only / Composite / Separate scores on report |
| Fixed **dimension weights** vs **teacher-adjustable** per class? | Fixed in policy / Per-class override |
| Source of truth for **tests & assignments** | Manual rubric / Gradebook+exams prefill / Both with override |
| Treatment of **missing** items (e.g. Punctuality 0) | Count as zero / Exclude from denominator / Block export until complete |

---

## 7. Success criteria

- Published weight table matches what the system calculates.
- Semi-monthly **Average Class Mark** matches gradebook reality when academic weight is primary.
- Fewer manual entry errors; optional export validation for incomplete inputs.
- Funders and teachers can explain any student’s number in one sentence (e.g. “60% weighted assignments, 40% conduct metrics”).

---

**Next step:** Leadership selects Model 1, 2, or 3 (or a hybrid), sets numeric weights, then development can implement Phase B (and Phase C only if formulas need it).
