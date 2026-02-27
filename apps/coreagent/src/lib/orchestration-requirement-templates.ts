export type RequirementTemplate = {
  id: string;
  label: string;
  preferredRole: 'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom';
  requiredAbilityKeys: string[];
};

export const REQUIREMENT_TEMPLATES: RequirementTemplate[] = [
  {
    id: 'research_web',
    label: 'Research (Web + Summary)',
    preferredRole: 'researcher',
    requiredAbilityKeys: ['search_web', 'read_repo'],
  },
  {
    id: 'implementation',
    label: 'Implementation (Code + Verify)',
    preferredRole: 'executor',
    requiredAbilityKeys: ['read_repo', 'write_repo', 'run_tests'],
  },
  {
    id: 'review_qa',
    label: 'Review / QA',
    preferredRole: 'reviewer',
    requiredAbilityKeys: ['read_repo', 'run_tests'],
  },
  {
    id: 'planning',
    label: 'Planning / Breakdown',
    preferredRole: 'planner',
    requiredAbilityKeys: ['read_repo'],
  },
];

export function templateAbilityCsv(templateId: string): string {
  const template = REQUIREMENT_TEMPLATES.find((item) => item.id === templateId);
  return template ? template.requiredAbilityKeys.join(', ') : '';
}
