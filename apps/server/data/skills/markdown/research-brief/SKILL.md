# Research Brief

## Topic
{{topic}}

## Audience + Depth
- **Audience:** {{audience}}
- **Depth:** {{depth}}

## Notes
{{notes}}

{{#if messageContext.userMessage}}
## Request Context
{{messageContext.userMessage}}
{{/if}}

## Attachment Signals
{{#each attachmentContent}}
- **{{this.storagePath}}** ({{this.fileType}})
  - Summary: {{this.summary}}
  - Excerpt: {{this.contentExcerpt}}
{{/each}}

## Key Findings
{{#each findings}}
- {{this}}
{{/each}}

## Risks / Unknowns
{{#each risks}}
- {{this}}
{{/each}}

## Recommendations
{{#each recommendations}}
1. {{this}}
{{/each}}

## Next Steps
{{#each next_steps}}
1. {{this}}
{{/each}}
