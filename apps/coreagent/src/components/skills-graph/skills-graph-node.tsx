import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getSkillsGraphNodeTheme, type SkillsGraphNodeData } from '@/lib/skills-graph-theme';

function SkillsGraphNodeImpl({
  data,
  selected,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
}: NodeProps) {
  const nodeData = data as SkillsGraphNodeData;
  const theme = getSkillsGraphNodeTheme(nodeData);
  const isAgent = nodeData.kind === 'agent';

  return (
    <div
      className="min-w-[220px] rounded-xl border px-3 py-2 text-sm transition-shadow"
      style={{
        borderColor: theme.border,
        background: theme.background,
        color: theme.text,
        boxShadow: selected ? theme.shadow : 'none',
      }}
    >
      <Handle type="target" position={targetPosition} className="!h-2.5 !w-2.5 !border-0 !bg-slate-300" />

      <div className="flex items-center justify-between gap-3">
        <div className="truncate font-medium">{nodeData.label}</div>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ background: theme.badge }}
        >
          {isAgent ? 'agent' : nodeData.level ?? 'skill'}
        </span>
      </div>

      {!isAgent && nodeData.category ? (
        <div className="mt-1 text-[11px] opacity-80">{nodeData.category}</div>
      ) : null}

      <Handle type="source" position={sourcePosition} className="!h-2.5 !w-2.5 !border-0 !bg-sky-300" />
    </div>
  );
}

export const SkillsGraphNode = memo(SkillsGraphNodeImpl);
