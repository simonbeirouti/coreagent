# CoreAgent Data Meaning Reference

This reference explains what key platform data means so product behavior is easier to interpret.

## Core Entities

- **Agent**: The configured AI teammate instance (identity, model/provider, lifecycle state).
- **Conversation**: A threaded interaction container tied to an agent.
- **Message**: A single user/assistant/system turn inside a conversation.
- **User Profile**: User-scoped preferences and working-style data.

## Memory And Retrieval

- **Message Embedding**: Vector representation of a message for semantic lookup.
- **Similarity Search**: Retrieval of relevant historical messages by vector distance.
- **Memory Hit/No-Hit**: Whether retrieval produced context above retrieval thresholds.

## Skills And Capability Tracking

- **Ability**: A named tool/capability available to agents.
- **Agent Ability**: Many-to-many relationship showing which abilities an agent has.
- **Proficiency**: A normalized signal of effectiveness for an ability over time.

## Feedback And Quality Layers

- **Message Quality Label**: System/orchestrator quality score per dimension.
- **User Rating**: Human feedback for dimensions like helpfulness, accuracy, tone, verbosity.
- **Reconciliation**: Fusion logic that combines system labels and user ratings.
- **Effective Signal**: Final score used by adaptation/retrieval logic after reconciliation.

## Provenance And Source Mix

- **Provenance**: The origin of a quality signal (for example user-driven vs system-driven).
- **Source Mix**: Distribution of signal origins used in decisions.
- **Confidence Coverage**: How much of the decision space has reliable confidence-backed signals.

## Guardrail Outcomes

- **Guardrail Outcome**: Policy/tuning result that constrains adaptation or retrieval changes.
- **Tuning Decision**: Latest stateful decision for retrieval behavior based on quality signals.
- **Hold/No-Change Outcome**: Guardrail prevented a change due to insufficient/conflicting signals.

## Practical Interpretation Tips

1. Prefer reconciled/effective signals over raw isolated inputs.
2. Read source mix with confidence coverage; one without the other is incomplete.
3. Treat guardrail holds as protective behavior, not as failures.
