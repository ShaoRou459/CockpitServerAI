# CockpitServerAI - Project Summary

## Overview

CockpitServerAI is a **Cockpit Web Plugin** that integrates AI-powered command-line assistance into the Cockpit Linux server management interface. It provides a chat-based interface where users can interact with AI assistants (OpenAI, Google Gemini, or compatible providers) to execute system administration tasks on Linux servers.

**Version**: 0.1.0
**Minimum Cockpit Version**: 137
**Node.js Requirement**: 18+

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Technology Stack](#technology-stack)
3. [Architecture Overview](#architecture-overview)
4. [Core Components](#core-components)
5. [Key Features](#key-features)
6. [Configuration & Settings](#configuration--settings)
7. [Security Model](#security-model)
8. [Data Flow](#data-flow)
9. [API Integration](#api-integration)
10. [Build & Development](#build--development)
11. [File Reference](#file-reference)

---

## Project Structure

```
CockpitServerAI/
├── src/                          # Source code directory
│   ├── components/               # React UI components (9 files)
│   │   ├── ChatPanel.tsx         # Chat interface with message display
│   │   ├── TerminalView.tsx      # Terminal wrapper component
│   │   ├── XTerminal.tsx         # xterm.js integration (PTY shell)
│   │   ├── SettingsModal.tsx     # Multi-page settings dialog
│   │   ├── OnboardingModal.tsx   # First-time setup wizard
│   │   ├── ApprovalModal.tsx     # Command approval UI
│   │   ├── DebugPanel.tsx        # Developer debug console
│   │   ├── SecretsIndicator.tsx  # Secret detection indicator
│   │   └── index.ts              # Component exports
│   ├── lib/                      # Business logic & utilities (8 files)
│   │   ├── agent.ts              # AI agent orchestration
│   │   ├── ai-client.ts          # Multi-provider AI client
│   │   ├── settings.ts           # Settings management
│   │   ├── types.ts              # TypeScript interfaces
│   │   ├── secrets.ts            # Secret detection & redaction
│   │   ├── debug-logger.ts       # Debug logging system
│   │   ├── cockpit.js            # Cockpit API wrapper
│   │   └── cockpit-dark-theme.js # Dark theme support
│   ├── app.tsx                   # Main application component
│   ├── app.scss                  # Global styles (79.6 KB)
│   ├── index.tsx                 # React entry point
│   ├── index.html                # HTML template
│   ├── manifest.json             # Cockpit plugin manifest
│   ├── cockpit.d.ts              # Cockpit API type definitions
│   └── ai-api-helper.py          # Python helper (unused)
├── dist/                         # Built output (generated)
├── test/                         # Test directory
├── pkg/                          # Package data
├── packaging/                    # Distribution files
├── build.js                      # esbuild configuration
├── package.json                  # Dependencies & scripts
├── tsconfig.json                 # TypeScript configuration
├── .eslintrc.json                # ESLint configuration
└── .stylelintrc.json             # Stylelint configuration
```

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.1 | UI component framework |
| TypeScript | 5.9.3 | Type-safe JavaScript |
| PatternFly | 6.4.0 | Enterprise UI component library |
| xterm.js | 5.5.0 | Terminal emulation |
| marked | 17.0.1 | Markdown rendering |
| SCSS | - | Styling with CSS variables |

### Build Tools
| Technology | Version | Purpose |
|------------|---------|---------|
| esbuild | 0.27.2 | Fast JavaScript bundler |
| esbuild-sass-plugin | 3.3.1 | SCSS compilation |
| ESLint | 9.39.2 | Code linting |
| Stylelint | 16.26.1 | CSS/SCSS linting |

### Runtime
| Technology | Purpose |
|------------|---------|
| Cockpit Platform | Server management interface |
| curl (via shell) | HTTP requests to AI APIs |
| bash | Command execution via PTY |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Cockpit Web Interface                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐              ┌─────────────────────┐   │
│  │   ChatPanel     │              │    TerminalView     │   │
│  │   (Messages)    │              │    (xterm.js PTY)   │   │
│  └────────┬────────┘              └──────────▲──────────┘   │
│           │                                  │              │
│  ┌────────▼──────────────────────────────────┴────────┐     │
│  │              Application (app.tsx)                  │     │
│  │   • State management    • Theme switching           │     │
│  │   • Settings handling   • Component coordination    │     │
│  └────────────────────────┬───────────────────────────┘     │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────┐     │
│  │              AgentController (agent.ts)             │     │
│  │   • Multi-step execution    • Approval workflow     │     │
│  │   • Command orchestration   • Result processing     │     │
│  └────────────────────────┬───────────────────────────┘     │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────┐     │
│  │              AIClient (ai-client.ts)                │     │
│  │   • OpenAI/Gemini support   • Response parsing      │     │
│  │   • HTTP via curl           • Error handling        │     │
│  └────────────────────────┬───────────────────────────┘     │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────┐     │
│  │              Cockpit API (cockpit.spawn/file)       │     │
│  └────────────────────────┬───────────────────────────┘     │
└───────────────────────────┼─────────────────────────────────┘
                            ▼
                    ┌──────────────┐
                    │  Linux Shell │
                    └──────────────┘
```

---

## Core Components

### UI Components (`src/components/`)

| Component | File | Description |
|-----------|------|-------------|
| **ChatPanel** | `ChatPanel.tsx` | Main chat interface with message history, user input, inline approvals, and markdown rendering |
| **TerminalView** | `TerminalView.tsx` | Wrapper for terminal with header controls and clear button |
| **XTerminal** | `XTerminal.tsx` | Full xterm.js terminal with Cockpit PTY integration, command execution, and output capture |
| **SettingsModal** | `SettingsModal.tsx` | 5-page settings dialog (Provider, Behavior, Security, Developer, About) |
| **OnboardingModal** | `OnboardingModal.tsx` | 4-step setup wizard (Welcome, Provider, Safety, Disclaimer) |
| **ApprovalModal** | `ApprovalModal.tsx` | Inline command approval cards with risk indicators |
| **DebugPanel** | `DebugPanel.tsx` | Floating debug console with filtering and export |
| **SecretsIndicator** | `SecretsIndicator.tsx` | Header badge showing detected secrets count |

### Business Logic (`src/lib/`)

| Module | File | Description |
|--------|------|-------------|
| **AgentController** | `agent.ts` | Orchestrates AI interactions, command execution, multi-step workflows |
| **AIClient** | `ai-client.ts` | Multi-provider HTTP client (OpenAI, Gemini, custom endpoints) |
| **Settings** | `settings.ts` | Configuration loading/saving, provider definitions, safety modes |
| **Types** | `types.ts` | TypeScript interfaces for Message, Action, Settings, etc. |
| **SecretManager** | `secrets.ts` | Pattern-based secret detection, redaction, and substitution |
| **DebugLogger** | `debug-logger.ts` | Centralized logging with categories, filtering, and export |

---

## Key Features

### 1. Multi-Provider AI Support
- **OpenAI**: GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo, o1-preview, o1-mini
- **Google Gemini**: Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash
- **Custom Endpoints**: Ollama, Azure OpenAI, OpenRouter, vLLM (OpenAI-compatible)

### 2. Safety System
Five configurable safety modes control auto-approval:

| Mode | Auto-Approves | Icon |
|------|--------------|------|
| Paranoid | Nothing | Lock |
| Cautious | Low risk | Shield |
| Moderate | Low + Medium risk | Bolt |
| YOLO | Low + Medium + High risk | Rocket |
| Full YOLO | Everything (dangerous) | Skull |

### 3. Command Blocklist
Default blocked patterns:
- `rm -rf /`, `rm -rf /*`
- Fork bombs: `:(){ :|:& };:`
- Disk operations: `mkfs`, `dd if=/dev/zero`, `> /dev/sda`

### 4. Secret Detection & Redaction
Automatically detects and redacts 15+ secret types:
- API keys (OpenAI, AWS, GitHub, GitLab, Slack)
- Tokens (Bearer, JWT)
- Private keys (RSA, DSA, EC, SSH, PGP)
- Database connection strings
- Password patterns

### 5. Terminal Features
- Persistent bash shell session (maintains CWD, environment)
- Full xterm.js emulation with colors and cursor
- Interactive command support (vim, ssh, sudo)
- Command output capture with exit codes

### 6. Multi-Step Agent Execution
- AI can run multiple commands to complete tasks
- Maintains conversation history for context
- Maximum 10 iterations to prevent infinite loops

### 7. Debug System
- Real-time log viewer
- Category filtering (API, parsing, actions, commands)
- JSON export functionality
- Sensitive data auto-redaction

### 8. Theming
- Light and dark mode support
- CSS variable-based theming
- PatternFly integration

---

## Configuration & Settings

### Settings File Location
```
~/.config/cockpit-ai-agent/settings.json
```

### Settings Structure
```typescript
interface Settings {
  // Provider Configuration
  provider: 'openai' | 'gemini'
  apiKey: string
  model: string
  baseUrl: string  // Optional custom endpoint

  // Behavior
  safetyMode: 'paranoid' | 'cautious' | 'moderate' | 'yolo' | 'full_yolo'
  maxTokens: number
  temperature: number  // 0-2

  // Security
  commandBlocklist: string[]
  secretRedaction: boolean
  logCommands: boolean

  // Developer
  debugMode: boolean

  // UI
  theme: 'light' | 'dark'
  onboardingComplete: boolean
}
```

### Default Values
```typescript
{
  provider: 'openai',
  model: 'gpt-4o',
  safetyMode: 'cautious',
  maxTokens: 4096,
  temperature: 0.7,
  secretRedaction: true,
  logCommands: true,
  debugMode: false,
  theme: 'light',
  onboardingComplete: false
}
```

---

## Security Model

### Authentication
- Uses Cockpit's built-in authentication
- User must be authenticated to Cockpit before accessing the plugin
- API keys stored per-user in home directory

### Command Approval Flow
```
AI Proposes Action
        ↓
Check Blocklist → Block if matched
        ↓
Check Safety Mode → Auto-approve if allowed
        ↓
Prompt User → Approve/Deny
        ↓
Execute if Approved
```

### Risk Levels
| Level | Color | Examples |
|-------|-------|----------|
| Low | Green | `ls`, `cat`, `pwd` |
| Medium | Orange | `apt install`, `systemctl restart` |
| High | Red | `rm`, `chmod 777`, file modifications |
| Critical | Purple | `rm -rf`, `dd`, disk operations |

### Secret Protection
1. **Detection**: Patterns scan all command output
2. **Redaction**: Secrets replaced with `__SECRET_N__` placeholders
3. **Substitution**: Placeholders replaced with actual values before execution
4. **Storage**: In-memory only, never persisted

---

## Data Flow

### User Message Processing
```
1. User types message in ChatPanel
2. App.tsx calls AgentController.processMessage()
3. AgentController builds system prompt with context
4. AIClient sends request to AI provider (via curl)
5. Response parsed for thought, actions, and reply
6. For each action:
   a. Check blocklist
   b. Determine approval requirement
   c. Get user approval if needed
   d. Execute via XTerminal.executeCommand()
   e. Capture output and exit code
   f. Redact secrets from output
   g. Send results back to AI
7. Repeat until AI returns no more actions (max 10 iterations)
8. Display final response in ChatPanel
```

### System Prompt Context
The AI receives:
- Current hostname
- Current working directory
- Current timestamp
- Available tools (command, file_read, file_write, service)
- Expected JSON response format
- Safety instructions

---

## API Integration

### OpenAI API
```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [...],
  "temperature": 0.7,
  "max_tokens": 4096
}
```

### Gemini API
```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
Content-Type: application/json

{
  "contents": [...],
  "systemInstruction": {...},
  "generationConfig": {...}
}
```

### Expected AI Response Format
```json
{
  "thought": "Analysis of what needs to be done...",
  "actions": [
    {
      "type": "command",
      "command": "ls -la /etc",
      "description": "List configuration files",
      "risk_level": "low"
    }
  ],
  "response": "Here's what I found..."
}
```

---

## Build & Development

### Scripts
```bash
npm install      # Install dependencies
npm run build    # Production build to dist/
npm run watch    # Development with auto-rebuild
npm run eslint   # Lint TypeScript/JavaScript
npm run stylelint # Lint CSS/SCSS
```

### Build Output (`dist/`)
```
dist/
├── index.js       # Bundled JavaScript (~2MB)
├── index.css      # Bundled CSS (~2.9MB)
├── index.html     # HTML template
├── manifest.json  # Cockpit manifest
├── po.js          # Localization placeholder
└── *.map          # Source maps (dev only)
```

### Development Workflow
1. Run `npm run watch` for auto-rebuild
2. Access Cockpit at `https://localhost:9090`
3. Navigate to "AI Agent" in the Cockpit menu
4. Changes rebuild automatically on file save

### Installation
```bash
# Build the plugin
npm run build

# Link to Cockpit plugins directory
mkdir -p ~/.local/share/cockpit
ln -s $(pwd)/dist ~/.local/share/cockpit/cockpit-ai-agent

# Or system-wide (requires root)
sudo ln -s $(pwd)/dist /usr/share/cockpit/cockpit-ai-agent
```

---

## File Reference

### Source Files by Lines of Code

| File | Lines | Purpose |
|------|-------|---------|
| `app.scss` | ~2000 | Global styles with theming |
| `OnboardingModal.tsx` | ~600 | First-time setup wizard |
| `SettingsModal.tsx` | ~550 | Configuration UI |
| `agent.ts` | ~500 | AI orchestration |
| `XTerminal.tsx` | ~400 | Terminal integration |
| `ChatPanel.tsx` | ~450 | Chat interface |
| `DebugPanel.tsx` | ~400 | Debug console |
| `ai-client.ts` | ~250 | AI provider client |
| `secrets.ts` | ~300 | Secret management |
| `debug-logger.ts` | ~250 | Logging system |
| `settings.ts` | ~200 | Settings management |
| `ApprovalModal.tsx` | ~150 | Approval UI |
| `SecretsIndicator.tsx` | ~150 | Secret indicator |
| `types.ts` | ~50 | Type definitions |

### Key TypeScript Interfaces

```typescript
// Message in chat history
interface Message {
  role: 'user' | 'assistant' | 'system' | 'action' | 'interactive'
  content: string
  timestamp: Date
  isError?: boolean
  action?: Action
  result?: CommandResult
}

// AI-proposed action
interface Action {
  type: 'command' | 'file_read' | 'file_write' | 'service'
  command?: string
  path?: string
  content?: string
  service?: string
  operation?: 'start' | 'stop' | 'restart' | 'status'
  description: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  interactive?: boolean
  interactive_hint?: string
}

// Command execution result
interface CommandResult {
  success: boolean
  output: string
  exitCode: number
  cwd: string
  action: Action
}
```

---

## Cockpit API Usage

### Key APIs Used

| API | Method | Purpose |
|-----|--------|---------|
| `cockpit.spawn()` | Shell execution | Run commands, curl for HTTP |
| `cockpit.file()` | File operations | Read/write config files |
| `cockpit.user()` | User info | Get home directory |

### PTY Shell Session
```typescript
// Create persistent shell
cockpit.spawn(['/bin/bash', '-c', 'cd; exec /bin/bash -i'], {
  pty: true,
  environ: ['TERM=xterm-256color']
})

// Send command with markers for output capture
proc.input(`${command}; __AI_EXIT_CODE__=$?; printf '___AI_CMD_DONE___%d___CWD___%s___\n' $__AI_EXIT_CODE__ "$PWD"\n`, true)
```

---

## Contributing

### Code Style
- TypeScript with strict mode enabled
- React functional components with hooks
- PatternFly 6 components for UI
- SCSS with CSS variables for theming
- ESLint + Stylelint for code quality

### Adding New Features
1. Create components in `src/components/`
2. Add business logic in `src/lib/`
3. Update types in `src/lib/types.ts`
4. Add styles to `src/app.scss`
5. Export from appropriate index files

### Testing
```bash
npm run eslint   # Check code quality
npm run stylelint # Check styles
npm run build    # Verify build succeeds
```

---

## License

See LICENSE file for details.

---

*Generated on: December 29, 2025*
