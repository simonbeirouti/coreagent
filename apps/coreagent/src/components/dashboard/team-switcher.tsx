"use client"

import * as React from "react"
import { ChevronsUpDown, FolderPlus } from "lucide-react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/use-auth"
import { useAgents, useCreateAgent, useProviderModels, useUpdateAgent } from "@/hooks/useAgents"
import { useCreateProject, useCurrentProject, useProjects, useSetCurrentProject } from "@/hooks/useProjects"
import type { Agent } from "@/types"
import { tauriCommandClient } from "@/lib/tauri-command-client"

type ManagerProvisioningMode = "existing" | "upgrade" | "create"

type ProviderModelInfo = {
  id: string
  provider: "openai" | "anthropic"
  display_name: string
}

function modelProvider(modelId: string): "openai" | "anthropic" {
  return modelId.toLowerCase().startsWith("claude") ? "anthropic" : "openai"
}

function isOpenAiManagerTier(modelId: string): boolean {
  const normalized = modelId.toLowerCase().trim()
  const match = normalized.match(/^gpt-(\d+)(?:[.-](\d+))?/)
  if (!match) return false
  const major = Number(match[1] || "0")
  return major >= 5
}

function isAnthropicManagerTier(modelId: string): boolean {
  const normalized = modelId.toLowerCase().trim()
  if (normalized.includes("claude-sonnet-4-5") || normalized.includes("claude-4.5")) {
    return true
  }
  const match = normalized.match(/claude-(?:[a-z]+-)?(\d+)(?:[.-](\d+))?/)
  if (!match) return false
  const major = Number(match[1] || "0")
  const minor = Number(match[2] || "0")
  if (major > 4) return true
  return major === 4 && minor >= 5
}

function isManagerTierModel(modelId: string): boolean {
  const provider = modelProvider(modelId)
  return provider === "openai" ? isOpenAiManagerTier(modelId) : isAnthropicManagerTier(modelId)
}

export function ProjectSwitcher() {
  const { isMobile } = useSidebar()
  const { user } = useAuth()
  const userId = user?.id || ""
  const { data: agents = [] } = useAgents(userId)
  const createAgentMutation = useCreateAgent()
  const updateAgentMutation = useUpdateAgent()
  const createProjectMutation = useCreateProject()
  const setCurrentProjectMutation = useSetCurrentProject()
  const { data: projects = [] } = useProjects(Boolean(user?.id))
  const { data: currentProject } = useCurrentProject(Boolean(user?.id))
  const { data: openAiModels = [], isLoading: isLoadingOpenAiModels } = useProviderModels("openai")
  const { data: anthropicModels = [], isLoading: isLoadingAnthropicModels } = useProviderModels("anthropic")

  const [createProjectOpen, setCreateProjectOpen] = React.useState(false)
  const [projectName, setProjectName] = React.useState("")
  const [projectObjective, setProjectObjective] = React.useState("")
  const [provisioningMode, setProvisioningMode] = React.useState<ManagerProvisioningMode>("existing")
  const [projectManagerAgentId, setProjectManagerAgentId] = React.useState("")
  const [upgradeAgentId, setUpgradeAgentId] = React.useState("")
  const [selectedManagerModelId, setSelectedManagerModelId] = React.useState("")
  const [newManagerName, setNewManagerName] = React.useState("")
  const [newManagerPersona, setNewManagerPersona] = React.useState("")

  const providerModels = React.useMemo<ProviderModelInfo[]>(
    () => [...openAiModels, ...anthropicModels],
    [openAiModels, anthropicModels]
  )
  const managerModelOptions = React.useMemo(
    () => providerModels.filter((model) => isManagerTierModel(model.id)),
    [providerModels]
  )
  const managerCandidates = React.useMemo(
    () => agents.filter((agent) => isManagerTierModel(agent.model_id)),
    [agents]
  )
  const managerById = React.useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])

  React.useEffect(() => {
    if (managerCandidates.length > 0) {
      setProvisioningMode((previous) => (previous === "create" || previous === "upgrade" ? previous : "existing"))
      if (!projectManagerAgentId || !managerCandidates.some((agent) => agent.id === projectManagerAgentId)) {
        setProjectManagerAgentId(managerCandidates[0].id)
      }
      return
    }
    if (agents.length > 0) {
      setProvisioningMode("upgrade")
      if (!upgradeAgentId || !agents.some((agent) => agent.id === upgradeAgentId)) {
        setUpgradeAgentId(agents[0].id)
      }
      return
    }
    setProvisioningMode("create")
  }, [agents, managerCandidates, projectManagerAgentId, upgradeAgentId])

  React.useEffect(() => {
    if (managerModelOptions.length === 0) {
      setSelectedManagerModelId("")
      return
    }
    if (selectedManagerModelId && managerModelOptions.some((model) => model.id === selectedManagerModelId)) {
      return
    }
    setSelectedManagerModelId(managerModelOptions[0].id)
  }, [managerModelOptions, selectedManagerModelId])

  const setCurrentProject = async (projectId: string) => {
    try {
      await setCurrentProjectMutation.mutateAsync(projectId)
    } catch {
      toast.error("Failed to switch project")
    }
  }

  const createProject = async () => {
    if (!user?.id) {
      toast.error("Authentication required")
      return
    }
    if (!projectName.trim()) {
      toast.error("Project name is required")
      return
    }
    if (!projectObjective.trim()) {
      toast.error("Project objective is required")
      return
    }
    if (managerModelOptions.length === 0) {
      toast.error("No manager-tier models available")
      return
    }

    try {
      let managerAgentId = ""

      if (provisioningMode === "existing") {
        if (!projectManagerAgentId) throw new Error("Select an existing manager agent")
        const managerAgent = managerById.get(projectManagerAgentId)
        if (!managerAgent) throw new Error("Manager agent not found")
        managerAgentId = managerAgent.id
      } else if (provisioningMode === "upgrade") {
        if (!upgradeAgentId) throw new Error("Select an agent to upgrade")
        if (!selectedManagerModelId) throw new Error("Select a target manager model")
        await updateAgentMutation.mutateAsync({
          agentId: upgradeAgentId,
          updates: {
            provider_type: modelProvider(selectedManagerModelId),
            model_id: selectedManagerModelId,
          },
        })
        managerAgentId = upgradeAgentId
      } else {
        if (!newManagerName.trim()) throw new Error("New manager name is required")
        if (!newManagerPersona.trim()) throw new Error("New manager persona is required")
        if (!selectedManagerModelId) throw new Error("Select a manager model")
        const createdAgent = await createAgentMutation.mutateAsync({
          user_id: user.id,
          name: newManagerName.trim(),
          persona: newManagerPersona.trim(),
          provider_type: modelProvider(selectedManagerModelId),
          model_id: selectedManagerModelId,
        })
        managerAgentId = createdAgent.id
      }

      const createdProject = await createProjectMutation.mutateAsync({
        manager_agent_id: managerAgentId,
        name: projectName.trim(),
        objective: projectObjective.trim(),
        priority: "normal",
      })

      // Bootstrap immediately so project creation has visible progression:
      // manager intake task, planning task, and kickoff conversation.
      const bootstrapTasks = [
        {
          title: "Review project brief and gather requirements",
          description: "Analyze objective, identify unknowns, and ask the user clarifying questions in manager chat.",
          required_ability_keys: ["conversation"],
          preferred_role: "planner",
        },
        {
          title: "Generate initial task backlog",
          description: "Break objective into actionable tasks with dependencies and success criteria.",
          required_ability_keys: ["conversation", "memory_retrieval"],
          preferred_role: "planner",
        },
        {
          title: "Evaluate assignments and dispatch first executable tasks",
          description: "Review capability fit and assign immediate tasks to the best-suited available agents.",
          required_ability_keys: ["conversation"],
          preferred_role: "planner",
        },
      ] as const

      const createdBootstrapTasks = await Promise.all(
        bootstrapTasks.map((task, index) =>
          invoke<{ id: string }>("create_orchestration_task", {
            request: {
              run_id: createdProject.run_id,
              owner_agent_id: managerAgentId,
              title: task.title,
              description: task.description,
              required_ability_keys: task.required_ability_keys,
              preferred_role: task.preferred_role,
              task_order: index,
            },
          })
        )
      )

      if (createdBootstrapTasks[0]?.id) {
        await invoke("update_orchestration_task_status", {
          taskId: createdBootstrapTasks[0].id,
          status: "in_progress",
          failureReason: null,
        })
      }

      await invoke("set_orchestration_schedule", {
        runId: createdProject.run_id,
        enabled: true,
        intervalMinutes: 15,
      })

      await tauriCommandClient.ensureProjectManagerConversation(createdProject.id)
      await tauriCommandClient.sendProjectManagerMessage(
        createdProject.id,
        [
          `You are the manager agent for project "${createdProject.name}".`,
          `Objective: ${createdProject.objective}.`,
          "Immediately perform these steps:",
          "1) Summarize your understanding of the project and assumptions.",
          "2) Ask clarifying questions for missing requirements.",
          "3) Propose initial backlog tasks with owners (manager or delegated agent) and priority.",
          "4) Mark which tasks can start immediately and why.",
          "Reply in concise structured sections.",
        ].join("\n")
      )

      setCreateProjectOpen(false)
      setProjectName("")
      setProjectObjective("")
      setNewManagerName("")
      setNewManagerPersona("")
      toast.success("Project created, bootstrapped, and manager kickoff started.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed creating project")
    }
  }

  if (!currentProject) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" onClick={() => setCreateProjectOpen(true)}>
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <FolderPlus className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">No Project</span>
              <span className="truncate text-xs">Create project</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <ProjectCreateDialog
          open={createProjectOpen}
          onOpenChange={setCreateProjectOpen}
          onCreate={createProject}
          isCreating={createProjectMutation.isPending || createAgentMutation.isPending || updateAgentMutation.isPending}
          projectName={projectName}
          setProjectName={setProjectName}
          projectObjective={projectObjective}
          setProjectObjective={setProjectObjective}
          provisioningMode={provisioningMode}
          setProvisioningMode={setProvisioningMode}
          projectManagerAgentId={projectManagerAgentId}
          setProjectManagerAgentId={setProjectManagerAgentId}
          upgradeAgentId={upgradeAgentId}
          setUpgradeAgentId={setUpgradeAgentId}
          selectedManagerModelId={selectedManagerModelId}
          setSelectedManagerModelId={setSelectedManagerModelId}
          newManagerName={newManagerName}
          setNewManagerName={setNewManagerName}
          newManagerPersona={newManagerPersona}
          setNewManagerPersona={setNewManagerPersona}
          managerCandidates={managerCandidates}
          managerModelOptions={managerModelOptions}
          agents={agents}
          isLoadingModels={isLoadingOpenAiModels || isLoadingAnthropicModels}
        />
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <FolderPlus className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{currentProject.name}</span>
                <span className="truncate text-xs">{currentProject.manager_agent_name}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">Projects</DropdownMenuLabel>
            {projects.map((project, index) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => {
                  void setCurrentProject(project.id)
                }}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <FolderPlus className="size-3.5 shrink-0" />
                </div>
                {project.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={() => setCreateProjectOpen(true)}>
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <FolderPlus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">Create project</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <ProjectCreateDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreate={createProject}
        isCreating={createProjectMutation.isPending || createAgentMutation.isPending || updateAgentMutation.isPending}
        projectName={projectName}
        setProjectName={setProjectName}
        projectObjective={projectObjective}
        setProjectObjective={setProjectObjective}
        provisioningMode={provisioningMode}
        setProvisioningMode={setProvisioningMode}
        projectManagerAgentId={projectManagerAgentId}
        setProjectManagerAgentId={setProjectManagerAgentId}
        upgradeAgentId={upgradeAgentId}
        setUpgradeAgentId={setUpgradeAgentId}
        selectedManagerModelId={selectedManagerModelId}
        setSelectedManagerModelId={setSelectedManagerModelId}
        newManagerName={newManagerName}
        setNewManagerName={setNewManagerName}
        newManagerPersona={newManagerPersona}
        setNewManagerPersona={setNewManagerPersona}
        managerCandidates={managerCandidates}
        managerModelOptions={managerModelOptions}
        agents={agents}
        isLoadingModels={isLoadingOpenAiModels || isLoadingAnthropicModels}
      />
    </SidebarMenu>
  )
}

type ProjectCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: () => void
  isCreating: boolean
  projectName: string
  setProjectName: (value: string) => void
  projectObjective: string
  setProjectObjective: (value: string) => void
  provisioningMode: ManagerProvisioningMode
  setProvisioningMode: (value: ManagerProvisioningMode) => void
  projectManagerAgentId: string
  setProjectManagerAgentId: (value: string) => void
  upgradeAgentId: string
  setUpgradeAgentId: (value: string) => void
  selectedManagerModelId: string
  setSelectedManagerModelId: (value: string) => void
  newManagerName: string
  setNewManagerName: (value: string) => void
  newManagerPersona: string
  setNewManagerPersona: (value: string) => void
  managerCandidates: Agent[]
  managerModelOptions: ProviderModelInfo[]
  agents: Agent[]
  isLoadingModels: boolean
}

function ProjectCreateDialog(props: ProjectCreateDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a project and choose how to provision a manager agent. Runs, tasks, and delegation are manager-automated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Project Name</Label>
            <Input value={props.projectName} onChange={(event) => props.setProjectName(event.target.value)} placeholder="Website Migration" />
          </div>
          <div className="space-y-2">
            <Label>Objective</Label>
            <Textarea
              value={props.projectObjective}
              onChange={(event) => props.setProjectObjective(event.target.value)}
              placeholder="Migrate docs site and validate deploy quality"
            />
          </div>
          <div className="space-y-2">
            <Label>Manager Provisioning</Label>
            <Select value={props.provisioningMode} onValueChange={(value) => props.setProvisioningMode(value as ManagerProvisioningMode)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose provisioning flow" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="existing">Use Existing Eligible Agent</SelectItem>
                <SelectItem value="upgrade">Upgrade Existing Agent</SelectItem>
                <SelectItem value="create">Create New Manager Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {props.provisioningMode === "existing" ? (
            <div className="space-y-2">
              <Label>Eligible Manager Agent (OpenAI 5 / Claude 4.5+)</Label>
              <Select value={props.projectManagerAgentId} onValueChange={props.setProjectManagerAgentId} disabled={props.managerCandidates.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose manager agent" />
                </SelectTrigger>
                <SelectContent>
                  {props.managerCandidates.map((agent: Agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} · {agent.model_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {props.provisioningMode !== "existing" ? (
            <div className="space-y-2">
              <Label>Target Manager Model</Label>
              <Select value={props.selectedManagerModelId} onValueChange={props.setSelectedManagerModelId} disabled={props.managerModelOptions.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={props.isLoadingModels ? "Loading provider models..." : "Choose manager model"} />
                </SelectTrigger>
                <SelectContent>
                  {props.managerModelOptions.map((model) => (
                    <SelectItem key={`${model.provider}-${model.id}`} value={model.id}>
                      {model.display_name} ({model.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {props.provisioningMode === "upgrade" ? (
            <div className="space-y-2">
              <Label>Agent To Upgrade</Label>
              <Select value={props.upgradeAgentId} onValueChange={props.setUpgradeAgentId} disabled={props.agents.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose agent to upgrade" />
                </SelectTrigger>
                <SelectContent>
                  {props.agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} · {agent.model_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {props.provisioningMode === "create" ? (
            <>
              <div className="space-y-2">
                <Label>New Manager Name</Label>
                <Input value={props.newManagerName} onChange={(event) => props.setNewManagerName(event.target.value)} placeholder="Project Manager" />
              </div>
              <div className="space-y-2">
                <Label>New Manager Persona</Label>
                <Textarea
                  value={props.newManagerPersona}
                  onChange={(event) => props.setNewManagerPersona(event.target.value)}
                  placeholder="Manager identity and orchestration behavior"
                />
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.isCreating}>
            Cancel
          </Button>
          <Button onClick={() => props.onCreate()} disabled={props.isCreating}>
            {props.isCreating ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
