# CoreAgent AI Core Tools

This document defines the core AI tools layer in CoreAgent: what tools exist today, which are mandatory, and how they are managed.

## Purpose

Core tools are the runtime capabilities that let an agent perceive context, retain memory, and communicate across modalities. They are foundational to chat, voice, and perception flows.

## Current Core Tool Categories

The following categories are treated as core and are always enabled:

- `memory`
- `perception`
- `communication`

In current backend behavior, tools in these categories cannot be disabled.

## Core Tools In Use

Current tool implementations include:

- `memory_retrieval` (memory)
- `vision_screenshot` (perception)
- `vision_analysis` (perception)
- `audio_transcription` (communication)
- `voice_synthesis` (communication)

These are registered via `abilities` and agent-specific runtime settings via `agent_abilities`.

## Tooling Data Model

Tooling is represented by:

- `abilities`:
  - global tool registry (`name`, `implementation_key`, `category`, `parameters_schema`)
- `agent_abilities`:
  - per-agent state (`enabled`, `config`, usage/proficiency metrics)

Even though `enabled` exists for per-agent capability control, core-category tools are enforced as always-on.

## Runtime Behavior

- Core tool categories remain enabled regardless of UI toggle attempts.
- Tool settings and runtime resolution are served by the backend ability service.
- Non-core tools (for example future automation/productivity tools) are expected to be toggleable per agent.

## Current UI Behavior

The agent tools route shows tools grouped by category and allows:

- status visibility (enabled/disabled)
- configuration editing where supported
- core tools marked as non-disableable

Current voice tool configuration supports selecting a default synthesis voice from predefined options.

## Next Expansion Areas

As Phase 3 advances, this tooling layer is expected to expand into:

- automation/delegation tools (Rig + swarms-rs)
- browser workflow tools (`navigate`, `extract`, `fill`)
- documentation workflow tools and orchestration traces

When these non-core tools are added, they should use the same registry + per-agent config model while preserving core tool invariants.
