import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

type UUID = string

type AgentSeed = {
  id: UUID
  name: string
  trait: TraitState
  abilityTotals: Record<string, AbilityTotals>
}

type TraitState = {
  helpfulness: number
  formality: number
  verbosity: number
  proactivity: number
  creativity: number
  empathy: number
}

type AbilityTotals = {
  usage_count: number
  success_count: number
  last_used_at: string | null
}

type SeedCounts = {
  userProfiles: number
  agents: number
  traitState: number
  agentAbilities: number
  conversations: number
  messages: number
  messageFeedback: number
  retrievalEvents: number
  retrievalJudgments: number
  tuningState: number
  tuningEvents: number
  qualityLabels: number
  qualityUserRatings: number
  qualityReconciliations: number
  skillSnapshots: number
  perceptionStats: number
  adaptationCycles: number
  personalityAdjustments: number
}

const SEED_SOURCE = 'ts_dashboard_test_seed_v1'
const AGENT_NAMES = ['Cody', 'Luna', 'Buddy'] as const
const RETRIEVAL_MODE = 'semantic_hybrid_test_seed'
const DAY_MS = 24 * 60 * 60 * 1000
const ABILITY_KEYS = [
  'conversation',
  'memory_retrieval',
  'audio_transcription',
  'voice_synthesis',
  'vision_screenshot',
  'vision_analysis',
] as const

type AbilityKey = (typeof ABILITY_KEYS)[number]

type Args = {
  userEmail: string
  userId: string
  days: number
  agents: number
}

const DEFAULT_COUNTS: SeedCounts = {
  userProfiles: 0,
  agents: 0,
  traitState: 0,
  agentAbilities: 0,
  conversations: 0,
  messages: 0,
  messageFeedback: 0,
  retrievalEvents: 0,
  retrievalJudgments: 0,
  tuningState: 0,
  tuningEvents: 0,
  qualityLabels: 0,
  qualityUserRatings: 0,
  qualityReconciliations: 0,
  skillSnapshots: 0,
  perceptionStats: 0,
  adaptationCycles: 0,
  personalityAdjustments: 0,
}

function logStep(message: string): void {
  console.log(`[SEED] ${message}`)
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) {
    return
  }

  const content = readFileSync(envPath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function parseArgs(argv: string[]): Args {
  const options = new Map<string, string>()

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      continue
    }

    const key = token.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument --${key}`)
    }
    options.set(key, value)
    i += 1
  }

  const userEmail = options.get('userEmail')
  const userId = options.get('userId')
  const days = Number(options.get('days') ?? '14')
  const agents = Number(options.get('agents') ?? '3')

  if (!userEmail) {
    throw new Error('Missing required argument --userEmail')
  }
  if (!userId) {
    throw new Error('Missing required argument --userId')
  }
  if (!Number.isInteger(days) || days <= 0 || days > 60) {
    throw new Error('--days must be an integer between 1 and 60')
  }
  if (!Number.isInteger(agents) || agents <= 0 || agents > 10) {
    throw new Error('--agents must be an integer between 1 and 10')
  }

  return {
    userEmail,
    userId,
    days,
    agents,
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, precision = 3): number {
  const scale = 10 ** precision
  const raw = Math.random() * (max - min) + min
  return Math.round(raw * scale) / scale
}

function pickRandom<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)]
}

function isoAt(base: Date, hours: number, minutes = 0): string {
  const timestamp = new Date(base.getTime())
  timestamp.setUTCHours(0, 0, 0, 0)
  timestamp.setUTCHours(hours, minutes, 0, 0)
  return timestamp.toISOString()
}

function startOfUtcDay(date: Date): Date {
  const next = new Date(date.getTime())
  next.setUTCHours(0, 0, 0, 0)
  return next
}

function dayDate(now: Date, dayIdx: number): Date {
  return new Date(startOfUtcDay(now).getTime() - dayIdx * DAY_MS)
}

function dailyFeedbackType(): 'positive' | 'negative' | 'neutral' {
  return pickRandom(['positive', 'negative', 'neutral'] as const)
}

function dailyFeedbackCategory(): 'helpfulness' | 'accuracy' | 'tone' | 'verbosity' {
  return pickRandom(['helpfulness', 'accuracy', 'tone', 'verbosity'] as const)
}

function feedbackNotesForCategory(category: 'helpfulness' | 'accuracy' | 'tone' | 'verbosity'): string {
  if (category === 'accuracy') {
    return pickRandom([
      'accuracy needs improvement',
      'factual answer and no hallucination',
      'answer had a mistake in details',
    ] as const)
  }
  if (category === 'tone') {
    return pickRandom([
      'tone felt too formal',
      'friendly and empathetic response',
      'response sounded harsh',
    ] as const)
  }
  if (category === 'verbosity') {
    return pickRandom([
      'too verbose for this request',
      'concise and brief answer',
      'response length is good',
    ] as const)
  }
  return pickRandom([
    'helpful actionable steps',
    'not very useful guidance',
    'clear and practical answer',
  ] as const)
}

function initialTrait(): TraitState {
  return {
    helpfulness: randomFloat(0.45, 0.9),
    formality: randomFloat(0.35, 0.9),
    verbosity: randomFloat(0.25, 0.85),
    proactivity: randomFloat(0.35, 0.9),
    creativity: randomFloat(0.35, 0.95),
    empathy: randomFloat(0.4, 0.95),
  }
}

function usageForFeedback(baseMin: number, baseMax: number, feedbackType: 'positive' | 'negative' | 'neutral') {
  const usage = randomInt(baseMin, baseMax)
  const penalty = feedbackType === 'negative' ? randomInt(2, 4) : randomInt(0, 2)
  const success = Math.max(0, usage - penalty)
  return { usage, success }
}

function usageBucketForAbility(key: AbilityKey, feedbackType: 'positive' | 'negative' | 'neutral') {
  if (key === 'conversation' || key === 'memory_retrieval') {
    return usageForFeedback(6, 22, feedbackType)
  }
  if (key === 'audio_transcription' || key === 'voice_synthesis') {
    return usageForFeedback(3, 16, feedbackType)
  }
  return usageForFeedback(2, 14, feedbackType)
}

async function run(): Promise<void> {
  const startedAt = Date.now()
  loadDotEnv()
  const args = parseArgs(process.argv)
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in environment variables')
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  logStep(`Starting seed run for ${args.userEmail} (${args.userId})`)
  logStep(`Target shape: ${args.agents} agent(s) across ${args.days} day(s)`)

  const {
    data: userData,
    error: userError,
  } = await supabase.auth.admin.getUserById(args.userId)

  if (userError) {
    throw userError
  }
  if (!userData?.user) {
    throw new Error(`No auth user found for --userId (${args.userId})`)
  }
  if ((userData.user.email ?? '').toLowerCase() !== args.userEmail.toLowerCase()) {
    throw new Error(
      `Provided --userEmail (${args.userEmail}) does not match auth user email (${userData.user.email ?? 'unknown'})`,
    )
  }

  const counts: SeedCounts = { ...DEFAULT_COUNTS }
  logStep(`Validated auth user: ${userData.user.email ?? 'unknown-email'}`)

  const {
    data: existingSeededAgents,
    error: seededAgentsError,
  } = await supabase
    .from('agents')
    .select('id,name')
    .eq('user_id', args.userId)
    .contains('behavioral_constraints', { seed_source: SEED_SOURCE })

  if (seededAgentsError) {
    throw seededAgentsError
  }

  const existingSeededAgentIds = (existingSeededAgents ?? []).map((agent) => agent.id as UUID)
  if (existingSeededAgentIds.length > 0) {
    logStep(`Found ${existingSeededAgentIds.length} existing seeded agent(s), deleting before reseed`)
    const { error: deleteAgentsError } = await supabase
      .from('agents')
      .delete()
      .in('id', existingSeededAgentIds)
      .eq('user_id', args.userId)

    if (deleteAgentsError) {
      throw deleteAgentsError
    }
  }

  const profilePayload = {
    user_id: args.userId,
    preferences: {
      communication_style: 'balanced',
      timezone: 'UTC',
      testing_mode: true,
      seed_source: SEED_SOURCE,
    },
    habits: {
      feedback_style: 'constructive',
      session_length: 'medium',
      preferred_hours: '9-17',
    },
    work_patterns: {
      domain: 'product',
      common_tasks: ['dashboard-validation', 'settings-validation'],
    },
    language: 'en',
    ai_response_language: 'en',
    notifications_enabled: true,
    analytics_enabled: true,
  }

  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert(profilePayload, { onConflict: 'user_id' })

  if (profileError) {
    throw profileError
  }
  counts.userProfiles += 1
  logStep('Ensured user_profiles row for settings')

  const requiredAbilities = [
    {
      name: 'Conversation',
      description: 'General text conversation handling',
      category: 'communication',
      implementation_key: 'conversation',
    },
    {
      name: 'Memory Retrieval',
      description: 'Semantic memory lookup for prior context',
      category: 'memory',
      implementation_key: 'memory_retrieval',
    },
    {
      name: 'Audio Transcription',
      description: 'Transcribe voice to text',
      category: 'communication',
      implementation_key: 'audio_transcription',
    },
    {
      name: 'Voice Synthesis',
      description: 'Generate audio responses',
      category: 'communication',
      implementation_key: 'voice_synthesis',
    },
    {
      name: 'Vision Screenshot',
      description: 'Capture and analyze screenshots',
      category: 'perception',
      implementation_key: 'vision_screenshot',
    },
    {
      name: 'Vision Analysis',
      description: 'Analyze user-provided images',
      category: 'perception',
      implementation_key: 'vision_analysis',
    },
  ] as const

  const { error: abilitiesSeedError } = await supabase
    .from('abilities')
    .upsert(requiredAbilities, { onConflict: 'implementation_key' })

  if (abilitiesSeedError) {
    throw abilitiesSeedError
  }
  logStep('Ensured required abilities exist')

  const { data: abilities, error: abilitiesError } = await supabase
    .from('abilities')
    .select('id,implementation_key')
    .in('implementation_key', [...ABILITY_KEYS])

  if (abilitiesError) {
    throw abilitiesError
  }

  const abilityIdByKey = new Map<AbilityKey, UUID>()
  for (const row of abilities ?? []) {
    abilityIdByKey.set(row.implementation_key as AbilityKey, row.id as UUID)
  }

  for (const key of ABILITY_KEYS) {
    if (!abilityIdByKey.has(key)) {
      throw new Error(`Missing required ability: ${key}`)
    }
  }

  const now = new Date()
  const agentsToSeed: AgentSeed[] = []

  for (let index = 0; index < args.agents; index += 1) {
    const agentId = randomUUID()
    const agentName = AGENT_NAMES[index] ?? `Agent-${index + 1}`
    const trait = initialTrait()
    const baseCreatedAt = new Date(now.getTime() - (args.days + 1) * DAY_MS).toISOString()

    const { error: agentInsertError } = await supabase.from('agents').insert({
      id: agentId,
      user_id: args.userId,
      name: agentName,
      persona: `Synthetic agent ${index + 1} for dashboard/settings visual testing and QA.`,
      provider_type: index % 2 === 0 ? 'openai' : 'anthropic',
      model_id: index % 2 === 0 ? 'gpt-4o-mini' : 'claude-3-5-sonnet-latest',
      state: 'active',
      mission: 'Generate realistic testing traffic for analytics and settings validation.',
      values: ['reliable', 'clear', 'practical'],
      behavioral_constraints: {
        response_style: {
          tone: pickRandom(['supportive', 'confident', 'friendly', 'analytical'] as const),
          format: pickRandom(['structured', 'conversational', 'step-by-step'] as const),
          brevity_bias: randomFloat(0.2, 0.8, 2),
        },
        safety: {
          disallow_hallucination: true,
          require_source_confidence: true,
        },
        trait_baseline: trait,
        seed_source: SEED_SOURCE,
      },
      created_at: baseCreatedAt,
      updated_at: now.toISOString(),
    })

    if (agentInsertError) {
      throw agentInsertError
    }
    counts.agents += 1
    logStep(`Created agent ${index + 1}/${args.agents}: ${agentName} (${agentId})`)

    const { error: traitInsertError } = await supabase.from('trait_state').upsert({
      agent_id: agentId,
      helpfulness: trait.helpfulness,
      formality: trait.formality,
      verbosity: trait.verbosity,
      proactivity: trait.proactivity,
      creativity: trait.creativity,
      empathy: trait.empathy,
      adaptation_enabled: true,
      baseline_source: 'seed_hybrid_v1',
      baseline_version: 'v1',
      baseline_context: {
        script: SEED_SOURCE,
        agent_name: agentName,
      },
      created_at: baseCreatedAt,
      updated_at: baseCreatedAt,
    }, { onConflict: 'agent_id' })

    if (traitInsertError) {
      throw traitInsertError
    }
    counts.traitState += 1

    const { error: tuningStateError } = await supabase.from('retrieval_tuning_state').upsert({
      agent_id: agentId,
      similarity_threshold: randomFloat(0.63, 0.78, 2),
      min_threshold: 0.55,
      max_threshold: 0.9,
      last_tuned_at: baseCreatedAt,
      last_decision_reason: 'seed_bootstrap',
      updated_at: baseCreatedAt,
    }, { onConflict: 'agent_id' })
    if (tuningStateError) {
      throw tuningStateError
    }
    counts.tuningState += 1

    const abilityRows = ABILITY_KEYS.map((key) => ({
      id: randomUUID(),
      agent_id: agentId,
      ability_id: abilityIdByKey.get(key),
      acquired_at: baseCreatedAt,
      usage_count: 0,
      success_count: 0,
      proficiency: 0,
      last_used_at: null,
    }))

    const { error: abilityInsertError } = await supabase
      .from('agent_abilities')
      .upsert(abilityRows, { onConflict: 'agent_id,ability_id' })

    if (abilityInsertError) {
      throw abilityInsertError
    }
    counts.agentAbilities += abilityRows.length

    agentsToSeed.push({
      id: agentId,
      name: agentName,
      trait,
      abilityTotals: Object.fromEntries(
        ABILITY_KEYS.map((key) => [key, { usage_count: 0, success_count: 0, last_used_at: null }]),
      ) as Record<string, AbilityTotals>,
    })
  }

  for (const seededAgent of agentsToSeed) {
    logStep(`Seeding activity for agent ${seededAgent.name} (${seededAgent.id})`)
    let visionTotal = 0
    let audioTotal = 0
    let lastPerceptionAt: string | null = null

    for (let dayIdx = args.days - 1; dayIdx >= 0; dayIdx -= 1) {
      logStep(`  Day ${args.days - dayIdx}/${args.days} (D-${dayIdx})`)
      const day = dayDate(now, dayIdx)
      const feedbackType = dailyFeedbackType()
      const feedbackCategory = dailyFeedbackCategory()
      const shouldOmitCategory = dayIdx % 4 === 0

      const conversationId = randomUUID()
      const userMsgId = randomUUID()
      const assistantMsgId = randomUUID()

      const conversationCreatedAt = isoAt(day, 10)
      const conversationUpdatedAt = isoAt(day, 0, 35)

      const { error: conversationError } = await supabase.from('conversations').insert({
        id: conversationId,
        agent_id: seededAgent.id,
        user_id: args.userId,
        title: `${seededAgent.name} D-${dayIdx} seeded conversation`,
        created_at: conversationCreatedAt,
        updated_at: conversationUpdatedAt,
      })

      if (conversationError) {
        throw conversationError
      }
      counts.conversations += 1

      const messagesPayload = [
        {
          id: userMsgId,
          conversation_id: conversationId,
          role: 'user',
          content: `Seed prompt for day ${dayIdx}: summarize usage and adaptation progress.`,
          message_type: 'text',
          metadata: { seeded: true, seed_source: SEED_SOURCE },
          parent_id: null,
          created_at: isoAt(day, 12),
        },
        {
          id: assistantMsgId,
          conversation_id: conversationId,
          role: 'assistant',
          content: `Seed response for day ${dayIdx} with synthetic dashboard metrics.`,
          message_type: 'text',
          metadata: { seeded: true, seed_source: SEED_SOURCE },
          parent_id: userMsgId,
          created_at: isoAt(day, 20),
        },
      ]

      const { error: messagesError } = await supabase.from('messages').insert(messagesPayload)
      if (messagesError) {
        throw messagesError
      }
      counts.messages += messagesPayload.length

      const { error: feedbackError } = await supabase.from('message_feedback').upsert({
        id: randomUUID(),
        message_id: assistantMsgId,
        user_id: args.userId,
        feedback_type: feedbackType,
        feedback_category: shouldOmitCategory ? null : feedbackCategory,
        notes: `seed:${SEED_SOURCE}:day:${dayIdx}:${feedbackType}/${feedbackCategory};${feedbackNotesForCategory(feedbackCategory)}`,
        created_at: isoAt(day, 30),
      }, { onConflict: 'message_id,user_id' })

      if (feedbackError) {
        throw feedbackError
      }
      counts.messageFeedback += 1

      const orchestratorScores = {
        tone_score: randomFloat(0.25, 0.95, 3),
        verbosity_score: randomFloat(0.2, 0.9, 3),
        helpfulness_score: randomFloat(0.25, 0.95, 3),
        accuracy_score: randomFloat(0.2, 0.95, 3),
        confidence: randomFloat(0.35, 0.95, 3),
      }
      const { error: labelError } = await supabase.from('message_quality_labels').upsert({
        id: randomUUID(),
        message_id: assistantMsgId,
        agent_id: seededAgent.id,
        ...orchestratorScores,
        orchestrator_version: 'seed_orchestrator_v1',
        status: 'reconciled',
        rationale: { seeded: true, seed_source: SEED_SOURCE, confidence_band: orchestratorScores.confidence },
        created_at: isoAt(day, 21),
        updated_at: isoAt(day, 21),
      }, { onConflict: 'message_id' })
      if (labelError) {
        throw labelError
      }
      counts.qualityLabels += 1

      const dimensions: Array<'tone' | 'verbosity' | 'helpfulness' | 'accuracy'> = [
        'tone',
        'verbosity',
        'helpfulness',
        'accuracy',
      ]
      const userOverrideCount = randomInt(1, 4)
      const selectedDimensions = [...dimensions]
        .sort(() => Math.random() - 0.5)
        .slice(0, userOverrideCount)
      for (const dimension of selectedDimensions) {
        const rating = Math.random() < 0.5 ? 'up' : 'down'
        const { error: userRatingError } = await supabase.from('message_quality_user_ratings').upsert({
          id: randomUUID(),
          message_id: assistantMsgId,
          agent_id: seededAgent.id,
          user_id: args.userId,
          dimension,
          rating,
          notes: `seed:${SEED_SOURCE}:dimension:${dimension}:${rating}`,
          created_at: isoAt(day, 21, 10),
          updated_at: isoAt(day, 21, 10),
        }, { onConflict: 'message_id,user_id,dimension' })
        if (userRatingError) {
          throw userRatingError
        }
        counts.qualityUserRatings += 1
      }

      const effective = {
        tone: orchestratorScores.tone_score,
        verbosity: orchestratorScores.verbosity_score,
        helpfulness: orchestratorScores.helpfulness_score,
        accuracy: orchestratorScores.accuracy_score,
      }
      for (const dimension of selectedDimensions) {
        const forced = Math.random() < 0.5 ? 1.0 : 0.0
        effective[dimension] = Number((effective[dimension] * 0.4 + forced * 0.6).toFixed(3))
      }
      const provenance = selectedDimensions.length === 0
        ? 'agent_only'
        : selectedDimensions.length >= 3
          ? 'user_override'
          : 'weighted_blend'
      const { error: reconciliationError } = await supabase.from('message_quality_reconciliation').upsert({
        id: randomUUID(),
        message_id: assistantMsgId,
        agent_id: seededAgent.id,
        effective_tone_score: effective.tone,
        effective_verbosity_score: effective.verbosity,
        effective_helpfulness_score: effective.helpfulness,
        effective_accuracy_score: effective.accuracy,
        source_mix: {
          user_ratings: selectedDimensions.length,
          agent_weight: 0.4,
          user_weight: 0.6,
          seeded: true,
        },
        provenance,
        created_at: isoAt(day, 21, 20),
        updated_at: isoAt(day, 21, 20),
      }, { onConflict: 'message_id' })
      if (reconciliationError) {
        throw reconciliationError
      }
      counts.qualityReconciliations += 1

      for (let eventIdx = 1; eventIdx <= 3; eventIdx += 1) {
        const retrievalResultCount = Math.random() < 0.2 ? 0 : randomInt(1, 4)
        const topSimilarity = retrievalResultCount === 0
          ? null
          : randomFloat(0.62, 0.97)
        const avgSimilarity = topSimilarity === null ? null : Math.max(0.55, topSimilarity - 0.08)
        const latencyMs = randomInt(80, 420)
        const retrievalEventId = randomUUID()
        const retrievalCreatedAt = isoAt(day, 9 + eventIdx)

        const { error: retrievalEventError } = await supabase.from('memory_retrieval_events').insert({
          id: retrievalEventId,
          agent_id: seededAgent.id,
          conversation_id: conversationId,
          query_fingerprint: createHash('md5')
            .update(`${seededAgent.id}:${dayIdx}:${eventIdx}:${Math.random()}`)
            .digest('hex'),
          query_length: randomInt(12, 120),
          similarity_threshold: randomFloat(0.55, 0.85, 2),
          max_results: randomInt(3, 8),
          result_count: retrievalResultCount,
          top_similarity: topSimilarity,
          avg_similarity: avgSimilarity,
          latency_ms: latencyMs,
          selected_memory_ids: retrievalResultCount === 0 ? [] : [assistantMsgId],
          used_in_response: eventIdx % 2 === 0,
          retrieval_mode: RETRIEVAL_MODE,
          created_at: retrievalCreatedAt,
        })

        if (retrievalEventError) {
          throw retrievalEventError
        }
        counts.retrievalEvents += 1

        const judgmentType = retrievalResultCount === 0
          ? 'negative'
          : topSimilarity !== null && topSimilarity >= 0.82
            ? 'positive'
            : feedbackType === 'negative'
              ? 'neutral'
              : 'positive'

        const { error: judgmentError } = await supabase.from('memory_retrieval_judgments').upsert({
          id: randomUUID(),
          event_id: retrievalEventId,
          user_id: args.userId,
          judgment_type: judgmentType,
          notes: `seed:${SEED_SOURCE}:d${dayIdx}/e${eventIdx}`,
          created_at: isoAt(day, 9 + eventIdx, 20),
        }, { onConflict: 'event_id,user_id' })

        if (judgmentError) {
          throw judgmentError
        }
        counts.retrievalJudgments += 1
      }

      if (dayIdx % 2 === 0) {
        const previousThreshold = randomFloat(0.62, 0.8, 2)
        const nextThreshold = clamp01(previousThreshold + randomFloat(-0.03, 0.03, 2))
        const tuningStatus = previousThreshold === nextThreshold ? 'skipped' : 'applied'
        const tuningReason = tuningStatus === 'applied'
          ? pickRandom(['improve_recall', 'improve_precision'] as const)
          : 'quality_guardrail_blocked'
        const { error: tuningEventError } = await supabase.from('retrieval_tuning_events').insert({
          id: randomUUID(),
          agent_id: seededAgent.id,
          previous_threshold: previousThreshold,
          next_threshold: nextThreshold,
          status: tuningStatus,
          reason: tuningReason,
          quality_summary: {
            sample_size: randomInt(24, 120),
            hit_rate: randomFloat(0.35, 0.92, 3),
            avg_top_similarity: randomFloat(0.72, 0.96, 3),
            p95_latency_ms: randomInt(120, 540),
          },
          guardrail_flags: {
            seeded: true,
            seed_source: SEED_SOURCE,
          },
          created_at: isoAt(day, 23, 10),
        })
        if (tuningEventError) {
          throw tuningEventError
        }
        counts.tuningEvents += 1
      }

      const skillRows = [
        {
          id: randomUUID(),
          agent_id: seededAgent.id,
          skill_key: 'chat',
          skill_name: 'Chat',
          rating: randomFloat(35, 99, 2),
          quality_score: randomFloat(0.3, 1),
          engagement_score: randomFloat(0.25, 1),
          feedback_score: randomFloat(0.2, 0.95),
          confidence_score: randomFloat(0.2, 1),
          usage_count: randomInt(5, 35),
          ability_usage_count: randomInt(3, 30),
          perception_usage_count: randomInt(0, 8),
          snapshot_at: isoAt(day, 20),
        },
        {
          id: randomUUID(),
          agent_id: seededAgent.id,
          skill_key: 'voice',
          skill_name: 'Voice',
          rating: randomFloat(30, 97, 2),
          quality_score: randomFloat(0.25, 1),
          engagement_score: randomFloat(0.2, 1),
          feedback_score: randomFloat(0.2, 0.95),
          confidence_score: randomFloat(0.2, 1),
          usage_count: randomInt(3, 25),
          ability_usage_count: randomInt(3, 20),
          perception_usage_count: randomInt(1, 12),
          snapshot_at: isoAt(day, 20),
        },
        {
          id: randomUUID(),
          agent_id: seededAgent.id,
          skill_key: 'screenshot',
          skill_name: 'Screenshot',
          rating: randomFloat(30, 98, 2),
          quality_score: randomFloat(0.25, 1),
          engagement_score: randomFloat(0.2, 1),
          feedback_score: randomFloat(0.2, 0.95),
          confidence_score: randomFloat(0.2, 1),
          usage_count: randomInt(3, 25),
          ability_usage_count: randomInt(2, 20),
          perception_usage_count: randomInt(1, 12),
          snapshot_at: isoAt(day, 20),
        },
      ]

      const { error: skillError } = await supabase.from('skill_rating_snapshots').insert(skillRows)
      if (skillError) {
        throw skillError
      }
      counts.skillSnapshots += skillRows.length

      visionTotal += randomInt(1, 5)
      audioTotal += randomInt(1, 4)
      lastPerceptionAt = isoAt(day, 19)

      const { error: perceptionError } = await supabase.from('perception_stats').upsert([
        {
          id: randomUUID(),
          agent_id: seededAgent.id,
          feature_type: 'vision',
          action: 'seed_vision_action',
          usage_count: visionTotal,
          last_used_at: lastPerceptionAt,
          metadata: { seeded: true, seed_source: SEED_SOURCE },
          created_at: isoAt(day, 19),
        },
        {
          id: randomUUID(),
          agent_id: seededAgent.id,
          feature_type: 'audio',
          action: 'seed_audio_action',
          usage_count: audioTotal,
          last_used_at: lastPerceptionAt,
          metadata: { seeded: true, seed_source: SEED_SOURCE },
          created_at: isoAt(day, 19),
        },
      ], { onConflict: 'agent_id,feature_type,action' })

      if (perceptionError) {
        throw perceptionError
      }
      counts.perceptionStats += 2

      for (const key of ABILITY_KEYS) {
        const totals = seededAgent.abilityTotals[key]
        const increment = usageBucketForAbility(key, feedbackType)
        totals.usage_count += increment.usage
        totals.success_count += increment.success
        totals.last_used_at = isoAt(day, 21)
      }

      if (Math.random() < 0.35) {
        const traitName = pickRandom(['helpfulness', 'formality', 'verbosity', 'proactivity'] as const)

        const oldValue = seededAgent.trait[traitName]
        const delta = feedbackType === 'negative'
          ? -randomFloat(0.01, 0.06)
          : randomFloat(0.01, 0.06)
        const nextValue = clamp01(oldValue + delta)
        seededAgent.trait[traitName] = nextValue

        const cycleId = randomUUID()
        const cycleCreatedAt = isoAt(day, 22)

        const { error: cycleError } = await supabase.from('adaptation_cycles').insert({
          id: cycleId,
          agent_id: seededAgent.id,
          window_started_at: new Date(day.getTime() - args.days * DAY_MS).toISOString(),
          window_ended_at: day.toISOString(),
          sample_size: randomInt(5, 20),
          signal_summary: { seeded: true, feedback_type: feedbackType, seed_source: SEED_SOURCE },
          guardrail_flags: { seeded: true, seed_source: SEED_SOURCE },
          applied_changes: {
            [traitName]: {
              old: oldValue,
              new: nextValue,
              delta: Number((nextValue - oldValue).toFixed(4)),
              driver: 'seed:feedback_pattern',
            },
          },
          status: 'applied',
          reason: `seed:${SEED_SOURCE}`,
          created_at: cycleCreatedAt,
        })

        if (cycleError) {
          throw cycleError
        }
        counts.adaptationCycles += 1

        const { error: adjustmentError } = await supabase.from('personality_adjustments').insert({
          id: randomUUID(),
          agent_id: seededAgent.id,
          trait_name: traitName,
          old_value: oldValue,
          new_value: nextValue,
          reason: `seed:${SEED_SOURCE}`,
          created_at: cycleCreatedAt,
        })

        if (adjustmentError) {
          throw adjustmentError
        }
        counts.personalityAdjustments += 1

        const { error: traitUpdateError } = await supabase.from('trait_state').update({
          helpfulness: seededAgent.trait.helpfulness,
          formality: seededAgent.trait.formality,
          verbosity: seededAgent.trait.verbosity,
          proactivity: seededAgent.trait.proactivity,
          creativity: seededAgent.trait.creativity,
          empathy: seededAgent.trait.empathy,
          updated_by_cycle_id: cycleId,
          updated_at: cycleCreatedAt,
        }).eq('agent_id', seededAgent.id)

        if (traitUpdateError) {
          throw traitUpdateError
        }
        logStep(`    Applied adaptation cycle (${traitName}: ${oldValue.toFixed(3)} -> ${nextValue.toFixed(3)})`)
      }
    }

    const abilityUpdates = ABILITY_KEYS.map((key) => {
      const totals = seededAgent.abilityTotals[key]
      const usageCount = totals.usage_count
      const successCount = totals.success_count
      return {
        agent_id: seededAgent.id,
        ability_id: abilityIdByKey.get(key),
        usage_count: usageCount,
        success_count: successCount,
        proficiency: usageCount === 0 ? 0 : Math.min(1, successCount / usageCount),
        last_used_at: totals.last_used_at,
      }
    })

    for (const updateRow of abilityUpdates) {
      const { error: abilityUpdateError } = await supabase
        .from('agent_abilities')
        .update({
          usage_count: updateRow.usage_count,
          success_count: updateRow.success_count,
          proficiency: updateRow.proficiency,
          last_used_at: updateRow.last_used_at,
        })
        .eq('agent_id', seededAgent.id)
        .eq('ability_id', updateRow.ability_id)

      if (abilityUpdateError) {
        throw abilityUpdateError
      }
    }
    logStep(`Finished agent ${seededAgent.name}`)
  }

  const startDate = dayDate(now, args.days - 1).toISOString()
  const endDate = dayDate(now, 0).toISOString()

  logStep('Seed complete')
  logStep(`Date range: ${startDate} -> ${endDate}`)
  logStep(
    `Agents: ${agentsToSeed.map((agent) => `${agent.name} (${agent.id})`).join(', ')}`,
  )
  console.table(counts)
  const elapsedMs = Date.now() - startedAt
  logStep(`Completed in ${(elapsedMs / 1000).toFixed(1)}s`)
}

run()
  .then(() => {
    logStep('Exiting process')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Seed failed.')
    console.error(error)
    process.exit(1)
  })
