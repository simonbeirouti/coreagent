import { fetchCount, fetchRows, getSupabaseConfigError, query } from "@/lib/supabase/rest";

type ProfileRow = {
  id: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
};

type UserProfileRow = {
  user_id: string;
  preferences: Record<string, unknown> | null;
  updated_at: string;
};

type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  provider_type: "openai" | "anthropic";
  model_id: string;
  state: "active" | "paused" | "stopped";
  mission: string | null;
  updated_at: string;
};

type AbilityRow = {
  id: string;
  name: string;
  category: string;
  implementation_key: string;
};

type AgentAbilityRow = {
  agent_id: string;
  ability_id: string;
  enabled: boolean;
  usage_count: number;
  success_count: number;
  proficiency: number;
  last_used_at: string | null;
};

type SkillRow = {
  id: string;
  skill_id: string;
  implementation_key: string;
  name: string;
  status: string;
  risk_level: string;
  updated_at: string;
};

type SkillVersionRow = {
  skill_ref_id: string;
  version: string;
  policy_status: string;
  published_at: string | null;
  revoked_at: string | null;
};

type SkillInstallRow = {
  user_id: string;
  skill_ref_id: string;
  install_state: string;
  updated_at: string;
};

type AdvisoryRow = {
  skill_ref_id: string;
  advisory_type: string;
  severity: string;
  title: string;
  resolved_at: string | null;
  published_at: string;
};

type RunRow = {
  id: string;
  parent_agent_id: string;
  title: string;
  status: string;
  priority: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  run_id: string;
  owner_agent_id: string;
  title: string;
  status: string;
  attempt_count: number;
  max_retries: number;
  updated_at: string;
};

type TaskAttemptRow = {
  task_id: string;
  status: string;
  latency_ms: number | null;
};

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function getConfigError(): string | null {
  return getSupabaseConfigError();
}

export async function getOverviewData() {
  const [
    users,
    agents,
    skills,
    runs,
    tasks,
    installs,
    advisories,
    abilities,
  ] = await Promise.all([
    fetchCount("profiles", query({ select: "id" })),
    fetchCount("agents", query({ select: "id" })),
    fetchCount("skills", query({ select: "id" })),
    fetchCount("orchestration_runs", query({ select: "id" })),
    fetchCount("orchestration_tasks", query({ select: "id" })),
    fetchCount("skill_installs", query({ select: "id" })),
    fetchCount("skill_advisories", query({ select: "id", resolved_at: "is.null" })),
    fetchCount("abilities", query({ select: "id" })),
  ]);

  return {
    cards: [
      { label: "Users", value: users.count, hint: "profiles" },
      { label: "Agents", value: agents.count, hint: "runtime identities" },
      { label: "Skills", value: skills.count, hint: "registry catalog" },
      { label: "Orchestration Runs", value: runs.count, hint: "job runs" },
      { label: "Open Tasks", value: tasks.count, hint: "all task records" },
      { label: "Installed Skills", value: installs.count, hint: "per-user installs" },
      { label: "Active Advisories", value: advisories.count, hint: "unresolved alerts" },
      { label: "Abilities", value: abilities.count, hint: "tool definitions" },
    ],
    errors: [
      users.error,
      agents.error,
      skills.error,
      runs.error,
      tasks.error,
      installs.error,
      advisories.error,
      abilities.error,
    ].filter(Boolean) as string[],
  };
}

export async function getUsersData() {
  const [profilesRes, userProfilesRes, agentsRes, installsRes] = await Promise.all([
    fetchRows<ProfileRow>(
      "profiles",
      query({
        select: "id,full_name,created_at,updated_at",
        order: "updated_at.desc",
        limit: "100",
      }),
    ),
    fetchRows<UserProfileRow>(
      "user_profiles",
      query({
        select: "user_id,preferences,updated_at",
        order: "updated_at.desc",
        limit: "100",
      }),
    ),
    fetchRows<Pick<AgentRow, "id" | "user_id">>(
      "agents",
      query({ select: "id,user_id", limit: "500" }),
    ),
    fetchRows<Pick<SkillInstallRow, "user_id" | "install_state">>(
      "skill_installs",
      query({ select: "user_id,install_state", limit: "500" }),
    ),
  ]);

  const agentCountByUser = new Map<string, number>();
  for (const row of agentsRes.data) {
    inc(agentCountByUser, row.user_id);
  }

  const installCountByUser = new Map<string, number>();
  for (const row of installsRes.data) {
    if (row.install_state === "installed") {
      inc(installCountByUser, row.user_id);
    }
  }

  const profileByUserId = new Map(userProfilesRes.data.map((row) => [row.user_id, row]));

  const rows = profilesRes.data.map((profile) => {
    const userProfile = profileByUserId.get(profile.id);
    const timezone =
      typeof userProfile?.preferences?.timezone === "string"
        ? userProfile.preferences.timezone
        : "-";

    return {
      id: profile.id,
      fullName: profile.full_name ?? "(No name)",
      timezone,
      agents: agentCountByUser.get(profile.id) ?? 0,
      installedSkills: installCountByUser.get(profile.id) ?? 0,
      updatedAt: profile.updated_at,
    };
  });

  return {
    rows,
    errors: [profilesRes.error, userProfilesRes.error, agentsRes.error, installsRes.error].filter(Boolean) as string[],
  };
}

export async function getAgentsData() {
  const [agentsRes, agentAbilitiesRes, tasksRes] = await Promise.all([
    fetchRows<AgentRow>(
      "agents",
      query({
        select: "id,user_id,name,provider_type,model_id,state,mission,updated_at",
        order: "updated_at.desc",
        limit: "100",
      }),
    ),
    fetchRows<AgentAbilityRow>(
      "agent_abilities",
      query({
        select: "agent_id,ability_id,enabled,usage_count,success_count,proficiency,last_used_at",
        limit: "1000",
      }),
    ),
    fetchRows<Pick<TaskRow, "owner_agent_id" | "status">>(
      "orchestration_tasks",
      query({
        select: "owner_agent_id,status",
        status: "in.(queued,planned,in_progress,waiting,paused)",
        limit: "1000",
      }),
    ),
  ]);

  const abilityCountByAgent = new Map<string, number>();
  const enabledAbilityByAgent = new Map<string, number>();
  for (const row of agentAbilitiesRes.data) {
    inc(abilityCountByAgent, row.agent_id);
    if (row.enabled) {
      inc(enabledAbilityByAgent, row.agent_id);
    }
  }

  const openTasksByAgent = new Map<string, number>();
  for (const row of tasksRes.data) {
    inc(openTasksByAgent, row.owner_agent_id);
  }

  const rows = agentsRes.data.map((agent) => ({
    id: agent.id,
    name: agent.name,
    state: agent.state,
    provider: `${agent.provider_type}:${agent.model_id}`,
    mission: agent.mission ?? "-",
    abilities: abilityCountByAgent.get(agent.id) ?? 0,
    enabledAbilities: enabledAbilityByAgent.get(agent.id) ?? 0,
    openTasks: openTasksByAgent.get(agent.id) ?? 0,
    updatedAt: agent.updated_at,
  }));

  return {
    rows,
    errors: [agentsRes.error, agentAbilitiesRes.error, tasksRes.error].filter(Boolean) as string[],
  };
}

export async function getSkillsData() {
  const [skillsRes, versionsRes, installsRes, advisoriesRes] = await Promise.all([
    fetchRows<SkillRow>(
      "skills",
      query({
        select: "id,skill_id,implementation_key,name,status,risk_level,updated_at",
        order: "updated_at.desc",
        limit: "100",
      }),
    ),
    fetchRows<SkillVersionRow>(
      "skill_versions",
      query({
        select: "skill_ref_id,version,policy_status,published_at,revoked_at",
        order: "published_at.desc",
        limit: "300",
      }),
    ),
    fetchRows<SkillInstallRow>(
      "skill_installs",
      query({
        select: "user_id,skill_ref_id,install_state,updated_at",
        limit: "1000",
      }),
    ),
    fetchRows<AdvisoryRow>(
      "skill_advisories",
      query({
        select: "skill_ref_id,advisory_type,severity,title,resolved_at,published_at",
        order: "published_at.desc",
        limit: "300",
      }),
    ),
  ]);

  const versionsBySkill = new Map<string, SkillVersionRow[]>();
  for (const row of versionsRes.data) {
    const existing = versionsBySkill.get(row.skill_ref_id) ?? [];
    existing.push(row);
    versionsBySkill.set(row.skill_ref_id, existing);
  }

  const installsBySkill = new Map<string, number>();
  for (const row of installsRes.data) {
    if (row.install_state === "installed") {
      inc(installsBySkill, row.skill_ref_id);
    }
  }

  const advisoriesBySkill = new Map<string, AdvisoryRow[]>();
  for (const row of advisoriesRes.data) {
    const existing = advisoriesBySkill.get(row.skill_ref_id) ?? [];
    existing.push(row);
    advisoriesBySkill.set(row.skill_ref_id, existing);
  }

  const rows = skillsRes.data.map((skill) => {
    const versions = versionsBySkill.get(skill.id) ?? [];
    const latestVersion = versions[0];
    const unresolved = (advisoriesBySkill.get(skill.id) ?? []).filter(
      (advisory) => advisory.resolved_at === null,
    );

    return {
      id: skill.id,
      skillId: skill.skill_id,
      name: skill.name,
      implementationKey: skill.implementation_key,
      status: skill.status,
      risk: skill.risk_level,
      latestVersion: latestVersion?.version ?? "-",
      policyStatus: latestVersion?.policy_status ?? "-",
      installs: installsBySkill.get(skill.id) ?? 0,
      unresolvedAdvisories: unresolved.length,
      updatedAt: skill.updated_at,
    };
  });

  return {
    rows,
    errors: [skillsRes.error, versionsRes.error, installsRes.error, advisoriesRes.error].filter(Boolean) as string[],
  };
}

export async function getJobsData() {
  const [runsRes, tasksRes, attemptsRes] = await Promise.all([
    fetchRows<RunRow>(
      "orchestration_runs",
      query({
        select: "id,parent_agent_id,title,status,priority,updated_at",
        order: "updated_at.desc",
        limit: "100",
      }),
    ),
    fetchRows<TaskRow>(
      "orchestration_tasks",
      query({
        select: "id,run_id,owner_agent_id,title,status,attempt_count,max_retries,updated_at",
        order: "updated_at.desc",
        limit: "300",
      }),
    ),
    fetchRows<TaskAttemptRow>(
      "orchestration_task_attempts",
      query({
        select: "task_id,status,latency_ms",
        order: "created_at.desc",
        limit: "500",
      }),
    ),
  ]);

  const openStatuses = new Set(["queued", "planned", "in_progress", "waiting", "paused"]);

  const openTasksByRun = new Map<string, number>();
  for (const task of tasksRes.data) {
    if (openStatuses.has(task.status)) {
      inc(openTasksByRun, task.run_id);
    }
  }

  const latestAttemptByTask = new Map<string, TaskAttemptRow>();
  for (const attempt of attemptsRes.data) {
    if (!latestAttemptByTask.has(attempt.task_id)) {
      latestAttemptByTask.set(attempt.task_id, attempt);
    }
  }

  const rows = runsRes.data.map((run) => {
    const runTasks = tasksRes.data.filter((task) => task.run_id === run.id);
    const avgLatency = runTasks
      .map((task) => latestAttemptByTask.get(task.id)?.latency_ms ?? null)
      .filter((latency): latency is number => latency !== null);

    const avgLatencyMs =
      avgLatency.length > 0
        ? Math.round(avgLatency.reduce((sum, value) => sum + value, 0) / avgLatency.length)
        : null;

    return {
      id: run.id,
      title: run.title,
      status: run.status,
      priority: run.priority,
      taskCount: runTasks.length,
      openTaskCount: openTasksByRun.get(run.id) ?? 0,
      avgLatencyMs,
      updatedAt: run.updated_at,
    };
  });

  return {
    rows,
    errors: [runsRes.error, tasksRes.error, attemptsRes.error].filter(Boolean) as string[],
  };
}

export async function getToolsData() {
  const [abilitiesRes, agentAbilitiesRes] = await Promise.all([
    fetchRows<AbilityRow>(
      "abilities",
      query({
        select: "id,name,category,implementation_key",
        order: "category.asc",
        limit: "500",
      }),
    ),
    fetchRows<AgentAbilityRow>(
      "agent_abilities",
      query({
        select: "agent_id,ability_id,enabled,usage_count,success_count,proficiency,last_used_at",
        limit: "5000",
      }),
    ),
  ]);

  const assignmentsByAbility = new Map<string, number>();
  const enabledByAbility = new Map<string, number>();

  for (const row of agentAbilitiesRes.data) {
    inc(assignmentsByAbility, row.ability_id);
    if (row.enabled) {
      inc(enabledByAbility, row.ability_id);
    }
  }

  const rows = abilitiesRes.data.map((ability) => ({
    id: ability.id,
    name: ability.name,
    category: ability.category,
    implementationKey: ability.implementation_key,
    assignedToAgents: assignmentsByAbility.get(ability.id) ?? 0,
    enabledOnAgents: enabledByAbility.get(ability.id) ?? 0,
  }));

  return {
    rows,
    errors: [abilitiesRes.error, agentAbilitiesRes.error].filter(Boolean) as string[],
  };
}
