# Decision Log

## Decision
- **Title:** {{decision_title}}
- **Selected Option:** {{selected_option}}

## Context
{{context}}

{{#if messageContext.userMessage}}
### User Request Context
{{messageContext.userMessage}}
{{/if}}

## Options Considered
{{#each options_considered}}
- {{this}}
{{/each}}

## Tradeoffs
{{#each tradeoffs}}
- {{this}}
{{/each}}

## Attachment Evidence
{{#each attachmentContent}}
- **{{this.storagePath}}** ({{this.fileType}})
  - Summary: {{this.summary}}
  - Excerpt: {{this.contentExcerpt}}
{{/each}}

## Validation Plan
{{#each follow_up_checks}}
- {{this}}
{{/each}}

## Rollback Trigger
{{rollback_trigger}}
