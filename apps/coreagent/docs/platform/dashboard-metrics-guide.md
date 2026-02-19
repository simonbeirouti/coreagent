# Dashboard Metrics Guide

This guide explains how to interpret dashboard cards and charts in CoreAgent.

## Skill And Ability Signals

- **Skill Trend**: Direction of capability over time (improving, stable, declining).
- **Proficiency**: Current normalized performance level for an ability.
- **Usage Context**: Frequent use with stable outcomes usually indicates reliable skill maturity.

## Memory And Retrieval Signals

- **Memory Quality**: Quality of retrieved context contributing to responses.
- **Hit/No-Hit Patterns**: Indicates retrieval effectiveness for recent interaction types.
- **Retrieval Decision Context**: Latest tuning or hold decision attached to transparency surfaces.

## Two-Layer Quality Signals

- **System Labels**: Automated quality scoring across key dimensions.
- **User Ratings**: Human corrective input across the same dimensions.
- **Reconciled Output**: Decision-grade signal used by downstream logic.

## Transparency Cards

- **Source Mix**: Balance of user vs system contributions in current quality signals.
- **Confidence Coverage**: How much decision input has confidence support.
- **Guardrail Outcomes**: Whether changes were allowed, deferred, or blocked.

## Interpreting State Combinations

- High confidence + balanced source mix + allowed guardrail outcomes usually means trustworthy adaptation momentum.
- Low confidence + skewed source mix + repeated holds suggests more interaction/feedback is needed.
- Large metric movement after sparse input should be treated as provisional.

## Recommended Reading Order

1. Start with guardrail outcomes.
2. Check confidence coverage.
3. Inspect source mix.
4. Then review skill/memory trend cards.

This order helps avoid over-indexing on a single chart without decision context.
