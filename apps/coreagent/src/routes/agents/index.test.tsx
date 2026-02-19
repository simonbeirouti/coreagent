import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

const createAgentMutateAsync = vi.fn().mockResolvedValue({ id: 'agent-created' });

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => ({
    component: config.component,
  }),
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
    },
  }),
}));

vi.mock('@/hooks/useAgents', () => ({
  useAgents: () => ({
    data: [
      {
        id: 'agent-1',
        user_id: 'user-1',
        name: 'Support Agent',
        persona: 'Helps users with questions',
        provider_type: 'openai',
        model_id: 'gpt-4o',
        state: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    isLoading: false,
    error: null,
  }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAgent: () => ({
    mutateAsync: createAgentMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/components/agents/create-agent-form', () => ({
  CreateAgentForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (data: {
      name: string;
      persona: string;
      provider_type: 'openai' | 'anthropic';
      model_id: string;
    }) => void;
    onCancel: () => void;
  }) => (
    <div>
      <button
        onClick={() =>
          onSubmit({
            name: 'Created In Dialog',
            persona: 'A persona that is long enough',
            provider_type: 'openai',
            model_id: 'gpt-4o',
          })
        }
      >
        submit-create-form
      </button>
      <button onClick={onCancel}>cancel-create-form</button>
    </div>
  ),
}));

import { Route } from './index';

describe('agents index route', () => {
  it('opens create dialog and creates agent in place', async () => {
    createAgentMutateAsync.mockClear();

    const AgentsIndexComponent = (Route as unknown as { component: React.ComponentType }).component;
    render(<AgentsIndexComponent />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }));
    expect(screen.getByText('Create New Agent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'submit-create-form' }));

    await waitFor(() => {
      expect(createAgentMutateAsync).toHaveBeenCalledWith({
        name: 'Created In Dialog',
        persona: 'A persona that is long enough',
        provider_type: 'openai',
        model_id: 'gpt-4o',
        user_id: 'user-1',
      });
    });
  });
});
