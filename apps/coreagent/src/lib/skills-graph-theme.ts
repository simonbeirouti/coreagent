import type { DefaultEdgeOptions, Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

export type SkillsGraphNodeData = {
  label: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
  kind?: 'skill' | 'agent';
  category?: string;
};

type NodeVisualTheme = {
  border: string;
  background: string;
  shadow: string;
  text: string;
  badge: string;
};

const AGENT_THEME: NodeVisualTheme = {
  border: '#60a5fa',
  background: 'rgba(96, 165, 250, 0.25)',
  shadow: '0 10px 24px rgba(96, 165, 250, 0.18)',
  text: '#dbeafe',
  badge: 'rgba(96, 165, 250, 0.2)',
};

const SKILL_DEFAULT_THEME: NodeVisualTheme = {
  border: '#94a3b8',
  background: 'rgba(148, 163, 184, 0.25)',
  shadow: '0 10px 24px rgba(148, 163, 184, 0.16)',
  text: '#e2e8f0',
  badge: 'rgba(148, 163, 184, 0.2)',
};

const SKILL_CATEGORY_THEME: Record<string, NodeVisualTheme> = {
  automation: {
    border: '#34d399',
    background: 'rgba(52, 211, 153, 0.25)',
    shadow: '0 10px 24px rgba(52, 211, 153, 0.16)',
    text: '#d1fae5',
    badge: 'rgba(52, 211, 153, 0.2)',
  },
  memory: {
    border: '#a78bfa',
    background: 'rgba(167, 139, 250, 0.25)',
    shadow: '0 10px 24px rgba(167, 139, 250, 0.16)',
    text: '#ede9fe',
    badge: 'rgba(167, 139, 250, 0.2)',
  },
  perception: {
    border: '#f59e0b',
    background: 'rgba(245, 158, 11, 0.25)',
    shadow: '0 10px 24px rgba(245, 158, 11, 0.16)',
    text: '#fef3c7',
    badge: 'rgba(245, 158, 11, 0.2)',
  },
};

export function getSkillsGraphNodeTheme(data: SkillsGraphNodeData): NodeVisualTheme {
  if (data.kind === 'agent') return AGENT_THEME;
  if (!data.category) return SKILL_DEFAULT_THEME;
  return SKILL_CATEGORY_THEME[data.category] ?? SKILL_DEFAULT_THEME;
}

const EDGE_STYLE_DEFAULT = {
  stroke: '#94a3b8',
  strokeWidth: 2,
};

const EDGE_STYLE_ASSIGNED = {
  stroke: '#38bdf8',
  strokeWidth: 2.2,
};

const EDGE_LABEL_STYLE = {
  fill: '#e2e8f0',
  fontSize: 11,
  fontWeight: 500,
};

const EDGE_LABEL_BG_STYLE = {
  fill: 'rgba(15, 23, 42, 0.9)',
  fillOpacity: 1,
  rx: 4,
  ry: 4,
};

export const DEFAULT_SKILLS_GRAPH_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'step',
  animated: false,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#94a3b8',
  },
  style: EDGE_STYLE_DEFAULT,
  labelStyle: EDGE_LABEL_STYLE,
  labelBgStyle: EDGE_LABEL_BG_STYLE,
};

export function createSkillsGraphEdge(
  source: string,
  target: string,
  label?: string,
  id?: string
): Edge {
  const isAssigned = label === 'assigned';
  const cleanLabel = label && label.trim().length > 0 ? label : undefined;
  return {
    id: id ?? `edge-${source}-${target}`,
    source,
    target,
    type: 'step',
    label: cleanLabel,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: isAssigned ? '#38bdf8' : '#94a3b8',
    },
    style: isAssigned ? EDGE_STYLE_ASSIGNED : EDGE_STYLE_DEFAULT,
    labelStyle: EDGE_LABEL_STYLE,
    labelBgStyle: EDGE_LABEL_BG_STYLE,
  };
}
