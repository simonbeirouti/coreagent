export type OverviewCard = {
  label: string;
  value: number;
  hint: string;
};

export type OverviewData = {
  cards: OverviewCard[];
  errors: string[];
  configError?: string | null;
};

export type UsersRow = {
  id: string;
  fullName: string;
  timezone: string;
  agents: number;
  installedSkills: number;
  updatedAt: string;
};

export type UsersData = {
  rows: UsersRow[];
  errors: string[];
};

export type AgentState = "active" | "paused" | "stopped";

export type AgentsRow = {
  id: string;
  name: string;
  state: AgentState;
  provider: string;
  mission: string;
  abilities: number;
  enabledAbilities: number;
  openTasks: number;
  updatedAt: string;
};

export type AgentsData = {
  rows: AgentsRow[];
  errors: string[];
};

export type SkillsRow = {
  id: string;
  skillId: string;
  name: string;
  implementationKey: string;
  status: string;
  risk: string;
  latestVersion: string;
  policyStatus: string;
  installs: number;
  unresolvedAdvisories: number;
  updatedAt: string;
};

export type SkillsData = {
  rows: SkillsRow[];
  errors: string[];
};

export type JobsRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  taskCount: number;
  openTaskCount: number;
  avgLatencyMs: number | null;
  updatedAt: string;
};

export type JobsData = {
  rows: JobsRow[];
  errors: string[];
};

export type ToolsRow = {
  id: string;
  name: string;
  category: string;
  implementationKey: string;
  assignedToAgents: number;
  enabledOnAgents: number;
};

export type ToolsData = {
  rows: ToolsRow[];
  errors: string[];
};
