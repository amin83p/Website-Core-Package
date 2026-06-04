## Prompt Policy Delta Matrix: Standard vs Strict

### 1. Purpose of the Policy Split
To improve reproducibility and transparency in the IELTS five-step scoring pipeline, two prompt policies are defined for AI-mediated steps (Step 3 evidence extraction and Step 4 micro-assessment scoring):

- `standard`: operational policy balancing evidence coverage and stability.
- `strict`: research policy prioritizing repeatability and low-variance outputs.

Both policies operate on the same architecture and model family; the delta is introduced through explicit prompt constraints and tighter acceptance criteria in strict mode.

### 2. Prompt Policy Delta Matrix
| Dimension | Standard Policy | Strict Policy | Expected Effect on Output | Dissertation Rationale |
|---|---|---|---|---|
| Evidence grounding rule | Direct textual grounding with reasonable examiner interpretation. | Explicit textual grounding only; avoid inference-heavy interpretation. | Strict reduces interpretive drift across repeated runs. | Isolates model stochasticity from interpretive subjectivity. |
| Precision vs recall target | Balanced precision and recall for evidence coverage. | Precision-first; include only high-confidence evidence references. | Strict produces fewer but more stable evidence indices. | Supports reproducibility-focused protocol. |
| Ambiguity handling (stance) | Conservative but allows contextual judgment when likely supported. | If ambiguous/mixed/implicit, prefer `unclear` and null stance index. | Strict lowers false-positive stance assignment. | Avoids over-claiming latent author position. |
| Sub-question evidence inclusion | Include likely relevant references conservatively. | Exclude borderline references unless directly supported by wording. | Strict reduces noisy or weak evidence links. | Improves auditability of evidence mapping. |
| Body-support evidence rule | Reasonable inclusion of supporting evidence where context indicates support. | Minimal/high-confidence support evidence only. | Strict reduces evidence set volatility across runs. | Enables cleaner consensus behavior in 3-run stability checks. |
| Step 4 item decision under uncertainty | Fair examiner-style interpretation with conservative safeguards. | Under borderline uncertainty, prefer `No` for deterministic reproducibility. | Strict reduces optimistic variance in micro-item decisions. | Keeps threshold behavior consistent across repeated runs. |
| Evidence verbosity in response | Moderate evidence breadth. | Sparse, strongest references only. | Strict narrows response entropy and lowers run-to-run variation. | Strengthens methodological control of AI output space. |
| Stability objective | Reliable operational output with acceptable variance. | Research-grade low variance and high repeatability. | Strict typically yields lower flip-rate tolerance and stronger agreement requirements. | Aligns with dissertation reproducibility standards. |

### 3. Implemented Prompt Content Differences
The policy split is not only threshold-level. It is explicitly injected into prompt text.

#### 3.1 Step 3 (Evidence Extraction) Prompt Delta
**Standard policy block**
```text
STABILITY PROFILE: STANDARD
- Use direct textual grounding and reasonable examiner inference.
- Balance precision and recall for evidence coverage.
- If evidence is likely relevant, include it conservatively.
```

**Strict policy block**
```text
STABILITY PROFILE: STRICT
- Use explicit textual grounding only; avoid inferential leaps.
- Prefer precision over recall: include sentence indices only when directly supported by wording.
- If stance is implicit or mixed, prefer stance="unclear" with stanceSentenceIndex=null.
- For answersBySubquestion/bodySupport, do not include borderline indices.
- Keep outputs minimal and reproducible across repeated runs.
```

#### 3.2 Step 4 (Micro-assessment Scoring) Prompt Delta
**Standard policy block**
```text
STABILITY PROFILE: STANDARD
- Use explicit evidence and reasonable examiner interpretation.
- Balance fairness and coverage while remaining conservative.
- Include relevant evidence without over-expanding weak support.
```

**Strict policy block**
```text
STABILITY PROFILE: STRICT
- Use only explicit textual evidence; avoid inference-heavy interpretation.
- If uncertain or borderline, prefer "No" for deterministic reproducibility.
- Keep evidence minimal and high-confidence (strongest refs only).
- Do not over-credit weak or indirect support.
```

### 4. Why Step 3 Stability + Consensus (3x) Is Required
Step 3 is the first non-deterministic stage in the pipeline. Steps 1 and 2 are deterministic transformations, but Step 3 relies on model-generated evidence references. Therefore, variance introduced at Step 3 can propagate to Step 4 scoring and final feedback.

The `Stability + Consensus (3x)` design is used because:

1. Three runs are the smallest odd-size sample enabling majority vote without tie inflation.
2. Pairwise agreement, flip rate, and unstable share quantify extraction reliability rather than assuming it.
3. Consensus replacement of unstable signals reduces downstream scoring sensitivity to single-run stochasticity.
4. The mechanism preserves explainability by keeping run diagnostics and consensus decisions visible in the report.

Methodologically, this establishes a controlled interface between deterministic preprocessing and probabilistic evidence extraction, improving replicability claims in dissertation reporting.

### 5. Operational vs Research Use
For production operations, `standard` is suitable when throughput and practical robustness are both required.  
For dissertation experiments, calibration studies, and repeated-run reliability analysis, `strict` is the preferred policy because it enforces tighter prompt constraints and lower tolerated variance.

### 6. Suggested Citation Sentence for Method Section
"To control model-induced stochasticity, we implemented a policy-conditioned prompting framework (standard vs strict) and applied a three-run Step 3 stability-consensus protocol, with agreement, flip-rate, and unstable-share diagnostics used as explicit reliability gates prior to downstream scoring."

