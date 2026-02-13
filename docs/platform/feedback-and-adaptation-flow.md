# Feedback And Adaptation Flow

This guide explains what happens after feedback is submitted and how those signals influence system behavior.

## End-To-End Flow

1. User interacts with an assistant response in chat.
2. Per-dimension feedback is captured (`helpfulness`, `accuracy`, `tone`, `verbosity`).
3. System quality labels and user ratings are reconciled into effective signals.
4. Adaptation and retrieval tuning read the reconciled/provenance-aware signals.
5. Dashboard surfaces the resulting trends, source mix, and guardrail outcomes.

## Signal Lifecycle

- **Capture**: Feedback event is recorded against the relevant message and user scope.
- **Reconcile**: Inputs are fused into stable per-dimension signals.
- **Decide**: Adaptation/retrieval logic evaluates whether to change behavior.
- **Guardrail Check**: Safety constraints can hold, defer, or allow updates.
- **Expose**: Dashboard transparency cards show the decision context.

## What "Good" Looks Like

- User feedback produces visible updates in dashboard signals over time.
- Reconciled metrics remain internally consistent across cards/charts.
- Guardrails prevent low-confidence or contradictory updates.

## Common Misreads

- A single positive rating does not imply immediate broad adaptation.
- A guardrail hold is usually expected when confidence is low.
- Source mix changes should be interpreted as trend shifts, not one-off anomalies.

## Validation Checklist

- Submit feedback on multiple assistant turns.
- Confirm per-dimension signals appear in dashboard views.
- Verify latest retrieval/adaptation context updates after enough signal volume.
- Confirm no indefinite streaming hangs during interaction-heavy sessions.
