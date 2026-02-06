# CoreAgent

Cloud-first, multimodal AI agent platform built with Rust + Supabase where agents see, hear, interact with the web, and evolve unique identities over time.

## Current Status
Phase 0 (Foundation) complete. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for detailed status.

## Tech Stack
- **Frontend**: React 19 + TypeScript + TanStack Router + Shadcn UI + Tailwind CSS
- **Backend**: Tauri 2.0 + Rust
- **Auth**: Supabase Auth
- **Planned**: Rig AI framework, SeaORM, PostgreSQL + pgvector

## Prerequisites
- Node.js 18+
- Rust 1.70+
- pnpm (recommended)

## Getting Started

### 1. Clone and Install Dependencies
```bash
git clone <repository-url>
cd coreagent
pnpm install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

### 3. Development
```bash
# Start full-stack development (frontend + backend)
pnpm run tauri dev

# Or run separately:
pnpm dev              # Frontend only (Vite)
pnpm run tauri dev    # Backend + Frontend
```

### 4. Build for Production
```bash
pnpm run tauri build
```

## Development Commands

```bash
# Check code quality
pnpm check            # TypeScript + Rust checks
pnpm check:ts         # TypeScript only
pnpm check:rust       # Rust only

# Build
pnpm build            # Frontend build
pnpm run tauri build  # Full application build
```

## Documentation

- **[PRD.md](PRD.md)** - Product requirements and vision (complete roadmap)
- **[IMPLEMENTATION.md](IMPLEMENTATION.md)** - Current implementation status
- **[avatar_prd.md](avatar_prd.md)** - Avatar system feature specification

## Project Structure

```
coreagent/
├── src/                    # Frontend (React)
│   ├── components/         # UI components (Shadcn UI)
│   ├── routes/            # Page components (TanStack Router)
│   ├── hooks/             # Custom React hooks
│   └── lib/               # Utilities and configs
├── src-tauri/             # Backend (Rust/Tauri)
│   ├── src/               # Rust source code
│   └── Cargo.toml         # Rust dependencies
├── public/                # Static assets
└── docs/                  # Documentation
    ├── PRD.md
    ├── IMPLEMENTATION.md
    └── avatar_prd.md
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Contributing

1. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for current development priorities
2. Check [PRD.md](PRD.md) for feature roadmap and requirements
3. Follow the established code patterns and component structure
