import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';

export interface ConstraintDefinition {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'string' | 'boolean' | 'array' | 'select';
  options?: string[]; // For select type
  placeholder?: string;
  defaultValue?: any;
}

export interface BehavioralConstraint {
  key: string;
  value: any;
  definition: ConstraintDefinition;
}

const CONSTRAINT_DEFINITIONS: ConstraintDefinition[] = [
  // Response Control
  {
    key: 'max_response_length',
    label: 'Maximum Response Length',
    description: 'Limit the length of responses (in characters)',
    type: 'number',
    placeholder: '500',
    defaultValue: 500,
  },
  {
    key: 'min_response_length',
    label: 'Minimum Response Length',
    description: 'Minimum length for responses (in characters)',
    type: 'number',
    placeholder: '50',
    defaultValue: 50,
  },
  {
    key: 'response_style',
    label: 'Response Style',
    description: 'Preferred style of responses',
    type: 'select',
    options: ['concise', 'detailed', 'balanced', 'technical', 'conversational'],
    defaultValue: 'balanced',
  },

  // Content Filtering
  {
    key: 'avoid_topics',
    label: 'Topics to Avoid',
    description: 'Comma-separated list of topics to avoid discussing',
    type: 'array',
    placeholder: 'politics, religion, controversial topics',
  },
  {
    key: 'allowed_languages',
    label: 'Allowed Languages',
    description: 'Languages the agent can respond in (comma-separated)',
    type: 'array',
    placeholder: 'English, Spanish, French',
  },

  // Behavior Rules
  {
    key: 'tone',
    label: 'Tone',
    description: 'Overall tone of responses',
    type: 'select',
    options: ['professional', 'casual', 'formal', 'friendly', 'authoritative'],
    defaultValue: 'professional',
  },
  {
    key: 'humor_level',
    label: 'Humor Level',
    description: 'Amount of humor in responses',
    type: 'select',
    options: ['none', 'light', 'moderate', 'high'],
    defaultValue: 'light',
  },
  {
    key: 'question_answering',
    label: 'Question Answering Style',
    description: 'How questions should be answered',
    type: 'select',
    options: ['direct', 'explanatory', 'comprehensive', 'step-by-step'],
    defaultValue: 'explanatory',
  },

  // Safety & Ethics
  {
    key: 'content_filtering',
    label: 'Content Filtering',
    description: 'Enable content safety filtering',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'age_appropriate',
    label: 'Age Appropriate Content',
    description: 'Ensure responses are appropriate for general audiences',
    type: 'boolean',
    defaultValue: true,
  },

  // Interaction Style
  {
    key: 'follow_up_questions',
    label: 'Follow-up Questions',
    description: 'When to ask follow-up questions',
    type: 'select',
    options: ['auto', 'ask_permission', 'never'],
    defaultValue: 'auto',
  },
  {
    key: 'clarification_requests',
    label: 'Clarification Requests',
    description: 'When to ask for clarification',
    type: 'select',
    options: ['when_needed', 'always', 'minimal'],
    defaultValue: 'when_needed',
  },
];

interface BehavioralConstraintsBuilderProps {
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  className?: string;
}

export function BehavioralConstraintsBuilder({
  value,
  onChange,
  className,
}: BehavioralConstraintsBuilderProps) {
  const [constraints, setConstraints] = useState<BehavioralConstraint[]>([]);

  // Convert JSON object to constraints array
  useEffect(() => {
    const constraintList: BehavioralConstraint[] = [];

    Object.entries(value || {}).forEach(([key, constraintValue]) => {
      const definition = CONSTRAINT_DEFINITIONS.find(def => def.key === key);
      if (definition) {
        constraintList.push({
          key,
          value: constraintValue,
          definition,
        });
      } else {
        // Custom constraint without definition
        constraintList.push({
          key,
          value: constraintValue,
          definition: {
            key,
            label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            description: 'Custom constraint',
            type: typeof constraintValue as any,
          },
        });
      }
    });

    setConstraints(constraintList);
  }, [value]);


  const addConstraint = (definition: ConstraintDefinition) => {
    const newConstraint: BehavioralConstraint = {
      key: definition.key,
      value: definition.defaultValue || getDefaultValueForType(definition.type),
      definition,
    };

    // Check if constraint already exists
    if (constraints.some(c => c.key === definition.key)) {
      return;
    }

    const newConstraints = [...constraints, newConstraint];
    setConstraints(newConstraints);
    updateParentValue(newConstraints);
  };

  const removeConstraint = (key: string) => {
    const newConstraints = constraints.filter(c => c.key !== key);
    setConstraints(newConstraints);
    updateParentValue(newConstraints);
  };

  const updateConstraint = (key: string, newValue: any) => {
    const newConstraints = constraints.map(c =>
      c.key === key ? { ...c, value: newValue } : c
    );
    setConstraints(newConstraints);
    updateParentValue(newConstraints);
  };

  const updateParentValue = (constraintList: BehavioralConstraint[]) => {
    const jsonObject: Record<string, any> = {};
    constraintList.forEach(constraint => {
      jsonObject[constraint.key] = constraint.value;
    });
    onChange(jsonObject);
  };

  const getDefaultValueForType = (type: ConstraintDefinition['type']): any => {
    switch (type) {
      case 'number': return 0;
      case 'string': return '';
      case 'boolean': return false;
      case 'array': return [];
      case 'select': return '';
      default: return null;
    }
  };

  const renderConstraintInput = (constraint: BehavioralConstraint) => {
    const { definition, value, key } = constraint;

    switch (definition.type) {
      case 'number':
        return (
          <Input
            type="number"
            value={value || ''}
            onChange={(e) => updateConstraint(key, parseInt(e.target.value) || 0)}
            placeholder={definition.placeholder}
          />
        );

      case 'string':
        return (
          <Input
            value={value || ''}
            onChange={(e) => updateConstraint(key, e.target.value)}
            placeholder={definition.placeholder}
          />
        );

      case 'boolean':
        return (
          <Select
            value={value ? 'true' : 'false'}
            onValueChange={(val) => updateConstraint(key, val === 'true')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
        );

      case 'array':
        return (
          <Input
            value={Array.isArray(value) ? value.join(', ') : value || ''}
            onChange={(e) => {
              const arrayValue = e.target.value.split(',').map(s => s.trim()).filter(s => s);
              updateConstraint(key, arrayValue);
            }}
            placeholder={definition.placeholder}
          />
        );

      case 'select':
        return (
          <Select
            value={value || ''}
            onValueChange={(val) => updateConstraint(key, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${definition.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {definition.options?.map(option => (
                <SelectItem key={option} value={option}>
                  {option.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      default:
        return (
          <Input
            value={typeof value === 'object' ? JSON.stringify(value) : value || ''}
            onChange={(e) => updateConstraint(key, e.target.value)}
          />
        );
    }
  };

  return (
    <div className={className}>
      {/* Add Constraint */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {CONSTRAINT_DEFINITIONS.filter(def =>
            !constraints.some(c => c.key === def.key)
          ).map(definition => (
            <Button
              key={definition.key}
              variant="outline"
              size="sm"
              onClick={() => addConstraint(definition)}
              className="justify-start h-auto p-3"
            >
              <div className="text-left">
                <div className="font-medium">{definition.label}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {definition.description}
                </div>
              </div>
            </Button>
          ))}
        </div>

        {/* Current Constraints */}
        {constraints.length > 0 && (
          <div className="space-y-3">
            {constraints.map(constraint => (
              <div key={constraint.key} className="flex items-center gap-3 p-3 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Label className="text-sm font-medium">{constraint.definition.label}</Label>
                    <Badge variant="secondary" className="text-xs">
                      {constraint.definition.type}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{constraint.definition.description}</p>
                </div>
                <div className="w-48">
                  {renderConstraintInput(constraint)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeConstraint(constraint.key)}
                  className="text-destructive hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}