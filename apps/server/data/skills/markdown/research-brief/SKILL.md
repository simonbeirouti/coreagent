# Research Brief Composer

## Purpose
Create a concise research brief from mixed notes, links, or findings.

## Inputs
- `topic`: primary topic to summarize
- `notes`: optional raw notes or references
- `audience`: optional audience (`engineering`, `product`, `ops`, `exec`)
- `depth`: optional output depth (`short`, `standard`, `deep`)

## Workflow
1. Restate the goal in one sentence.
2. Extract key facts and unresolved unknowns.
3. Cluster findings into 3-6 themes.
4. Produce recommendations with confidence labels.
5. End with a focused next-steps checklist.

## Output Format
- `Summary`: 3-5 bullets
- `Key Findings`: grouped bullets
- `Risks / Unknowns`: explicit gaps and blockers
- `Recommendations`: actionable, ordered by impact
- `Next Steps`: numbered list with owners if available

## Guardrails
- Do not invent facts.
- Mark assumptions explicitly.
- Prefer concise output over exhaustive narrative.
