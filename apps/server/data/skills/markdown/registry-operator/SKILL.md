# Registry Operator Plan

## Goal
- **Operation:** {{goal}}
- **Skill:** {{skill_id}}
- **Agent:** {{agent_id}}
- **Version:** {{version}}

{{#if messageContext.userMessage}}
## Request Context
{{messageContext.userMessage}}
{{/if}}

## Action Plan
{{#each action_plan}}
1. {{this}}
{{/each}}

## Commands
{{#each commands}}
```bash
{{this}}
```
{{/each}}

## Expected Responses
{{#each expected_responses}}
- {{this}}
{{/each}}

## Failure Handling
{{#each failure_handling}}
- {{this}}
{{/each}}

## Safety Notes
{{#each safety_notes}}
- {{this}}
{{/each}}
