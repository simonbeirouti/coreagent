# CoreAgent Feature Map

This guide maps major platform capabilities to where they appear in the product so users can quickly find the right surface.

## Agent Lifecycle

- Agent creation and configuration: agent management flows and agent settings
- Identity controls (mission, values, behavioral constraints): agent settings
- Provider/model configuration: agent settings

## Conversation And Chat

- Primary interaction surface: agent chat route
- Streaming responses: chat message area
- Message editing and branching: chat message actions
- Message deletion: chat message actions
- Per-message quality feedback controls: assistant message actions

## Dashboard And Transparency

- Identity analytics and summaries: agent dashboard
- Skill trends and memory quality signals: agent dashboard charts/cards
- Source mix, confidence coverage, and guardrail outcomes: transparency cards on dashboard
- Latest retrieval tuning decision: personality evolution/dashboard context

## User And Platform Settings

- User profile and preferences: user settings/profile surfaces
- Theme and presentation defaults: shared app settings/preferences

## Reliability And Testing Docs

- Reliability test execution and release gate: `docs/testing/two-layer-reliability.md`

## Recommended Navigation Pattern

When validating behavior end to end:
1. Start in chat (generate behavior and feedback signals).
2. Open dashboard (interpret resulting system state).
3. Return to settings (confirm intended constraints/configuration).

This sequence gives the clearest link between user action, system adaptation, and visible outcomes.
