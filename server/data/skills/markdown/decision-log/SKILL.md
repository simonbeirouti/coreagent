# Decision Log Writer

## Purpose
Turn a discussion or analysis into a durable decision record.

## Inputs
- `decision_title`
- `context`
- `options_considered`
- `selected_option`
- `tradeoffs`
- `follow_up_checks` (optional)

## Workflow
1. Capture decision scope and success criteria.
2. List options with 1-2 pros/cons each.
3. Record selected option and why it won.
4. Capture consequences (technical, product, operational).
5. Define validation checkpoints and rollback criteria.

## Output Format
- `Decision`
- `Context`
- `Options`
- `Chosen Path`
- `Tradeoffs`
- `Validation Plan`
- `Rollback Trigger`

## Guardrails
- Keep rationale testable.
- Avoid vague language like "seems better" without criteria.
- If evidence is weak, include explicit re-evaluation date.
