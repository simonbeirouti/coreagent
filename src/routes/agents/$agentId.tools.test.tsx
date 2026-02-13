import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => ({
    component: config.component,
    useParams: () => ({ agentId: 'agent-1' }),
  }),
}));

vi.mock('@/hooks/useAbilities', () => ({
  useAgentToolSettings: () => ({
    data: [
      {
        agent_id: 'agent-1',
        ability_id: 'a1',
        ability_name: 'Memory Retrieval',
        implementation_key: 'memory_retrieval',
        category: 'memory',
        enabled: true,
        config: {},
        parameters_schema: {},
        is_mandatory: true,
      },
      {
        agent_id: 'agent-1',
        ability_id: 'a2',
        ability_name: 'Vision Analysis',
        implementation_key: 'vision_analysis',
        category: 'perception',
        enabled: true,
        config: {},
        parameters_schema: {},
        is_mandatory: false,
      },
      {
        agent_id: 'agent-1',
        ability_id: 'a3',
        ability_name: 'Audio Transcription',
        implementation_key: 'audio_transcription',
        category: 'communication',
        enabled: true,
        config: {},
        parameters_schema: {},
        is_mandatory: false,
      },
    ],
    isLoading: false,
    error: null,
  }),
  useSetAgentAbilityEnabled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAgentAbilityConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { Route } from './$agentId.tools';

describe('tools route runtime', () => {
  it('renders category groups with tool toggles', () => {
    const ToolsComponent = (Route as unknown as { component: React.ComponentType }).component;
    render(<ToolsComponent />);

    expect(screen.getByText('Tool Access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect all' })).toBeInTheDocument();
    expect(screen.getByText('Memory Retrieval')).toBeInTheDocument();
    expect(screen.getByText('Vision Analysis')).toBeInTheDocument();
    expect(screen.getByText('Audio Transcription')).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
  });
});
