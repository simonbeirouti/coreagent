import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => ({
    component: config.component,
    useParams: () => ({ agentId: 'agent-1' }),
  }),
}));

vi.mock('@xyflow/react', () => ({
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useNodesState: () => [[], vi.fn(), vi.fn()],
}));

vi.mock('@/hooks/useAgents', () => ({
  useAgent: () => ({
    data: { id: 'agent-1', name: 'Research Bot' },
  }),
}));

vi.mock('@/hooks/useAbilities', () => ({
  useAgentRegistrySkills: () => ({
    data: [],
  }),
  useAgentToolSettings: () => ({
    data: [
      {
        ability_name: 'Memory Retrieval',
        implementation_key: 'memory_retrieval',
        category: 'memory',
        enabled: true,
        is_mandatory: true,
      },
    ],
  }),
  useSetAgentAbilityEnabled: () => ({
    mutateAsync: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRegistrySkills', () => ({
  useAssignRegistrySkill: () => ({
    mutateAsync: vi.fn(),
  }),
  useInstalledSkills: () => ({
    data: [],
  }),
}));

vi.mock('@/hooks/useSkillsGraph', () => ({
  useSkillsGraph: () => ({
    data: {
      graphJson: { nodes: [], edges: [], viewport: {} },
    },
  }),
  useSaveSkillsGraph: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSuggestSkillsGraphConnections: () => ({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({ proposedEdges: [] }),
  }),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { Route } from './$agentId.skills-graph';

describe('agent skills graph route', () => {
  it('renders agent context and icon controls', () => {
    const SkillsGraphComponent = (Route as unknown as { component: React.ComponentType }).component;
    render(<SkillsGraphComponent />);

    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto layout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search graph' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest connections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save graph' })).toBeInTheDocument();
  });
});
