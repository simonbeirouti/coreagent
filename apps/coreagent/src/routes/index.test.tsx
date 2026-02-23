import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => ({
    component: config.component,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  KeyboardSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock('@dnd-kit/modifiers', () => ({
  restrictToWindowEdges: vi.fn(),
}));

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: (list: string[], oldIndex: number, newIndex: number) => {
    const next = [...list];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    return next;
  },
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'test@example.com',
    },
  }),
}));

vi.mock('@/hooks/useAgents', () => ({
  useAgents: () => ({
    data: [
      {
        id: 'agent-1',
        user_id: 'user-1',
        name: 'Planner Agent',
        persona: 'Planner',
        provider_type: 'openai',
        model_id: 'gpt-4o-mini',
        state: 'active',
        created_at: '2026-02-16T00:00:00.000Z',
        updated_at: '2026-02-16T00:00:00.000Z',
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useOrchestration', () => ({
  useAgentDelegations: () => ({ data: [] }),
  useCreateAgentDelegation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCreateOrchestrationRun: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useRegistrySkills', () => ({
  useRuntimeSyncDiagnostics: () => ({
    data: null,
  }),
}));

import { Route } from './index';

describe('index route orchestration wizard', () => {
  it('opens guided assignment dialog from root route', () => {
    const DashboardComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <DashboardComponent />
      </QueryClientProvider>
    );

    expect(screen.getByText('Orchestration Board')).toBeInTheDocument();
    expect(screen.getByText('Idle Queue')).toBeInTheDocument();
    expect(screen.getByText('Working Now')).toBeInTheDocument();
    expect(screen.getByText('Ready For Review')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create job assignment/i }));

    expect(screen.getByText('Create Orchestration Assignment')).toBeInTheDocument();
    expect(screen.getByText('1. Select Agent')).toBeInTheDocument();
    expect(screen.getByText('Select Agent')).toBeInTheDocument();
  });
});
