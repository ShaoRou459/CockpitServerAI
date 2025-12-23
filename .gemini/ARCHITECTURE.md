# Cockpit AI Agent Plugin - Architecture Design

## Overview

A Cockpit plugin that provides an AI-powered terminal assistant. The AI agent can execute commands, manage system services, and perform administrative tasks with user oversight.

---

## ✅ Finalized Decisions

| Component | Decision | Rationale |
|-----------|----------|-----------|
| **AI Providers** | OpenAI, Gemini, Custom/OpenAI-compatible | Skip Anthropic (no CORS support) |
| **AI Calls** | Direct browser HTTPS | Simple, no proxy needed |
| **UI Framework** | React | Cockpit's recommended approach |
| **Design System** | PatternFly 5 | Native Cockpit look & feel |
| **Terminal** | xterm.js | Full emulator for interactive/sudo |
| **Build Tool** | Vite or Webpack | Use Cockpit starter kit as base |
| **Approval** | Risk-based + YOLO mode | Auto-approve low-risk in YOLO |

---

## Core Design Principles

1. **Bring Your Own API** - Support multiple AI providers with custom endpoints
2. **User Control** - Require approval for commands (with optional YOLO mode)
3. **Client-Side AI Calls** - API calls made directly from the browser
4. **Native Cockpit Integration** - Use Cockpit's APIs for system access

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        COCKPIT WEB INTERFACE                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    AI AGENT PLUGIN                             │  │
│  │                                                                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │  │
│  │  │   Chat UI    │  │ Terminal     │  │   Settings Panel     │  │  │
│  │  │              │  │ Output View  │  │                      │  │  │
│  │  │ • User input │  │              │  │ • Provider select    │  │  │
│  │  │ • AI replies │  │ • Live PTY   │  │ • API key input      │  │  │
│  │  │ • History    │  │ • Scrollback │  │ • Model selection    │  │  │
│  │  │              │  │              │  │ • Base URL override  │  │  │
│  │  └──────┬───────┘  └──────▲───────┘  │ • YOLO mode toggle   │  │  │
│  │         │                 │          └──────────────────────┘  │  │
│  │         │                 │                                    │  │
│  │  ┌──────▼─────────────────┴───────────────────────────────┐    │  │
│  │  │                  AGENT CONTROLLER                       │    │  │
│  │  │                                                         │    │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │    │  │
│  │  │  │   AI Client │  │  Command    │  │   Approval      │  │    │  │
│  │  │  │   Manager   │  │  Parser     │  │   Manager       │  │    │  │
│  │  │  │             │  │             │  │                 │  │    │  │
│  │  │  │ • Provider  │  │ • Extract   │  │ • Queue cmds    │  │    │  │
│  │  │  │   routing   │  │   commands  │  │ • Show dialog   │  │    │  │
│  │  │  │ • Streaming │  │ • Parse     │  │ • YOLO bypass   │  │    │  │
│  │  │  │ • Retries   │  │   actions   │  │ • Audit log     │  │    │  │
│  │  │  └──────┬──────┘  └─────────────┘  └────────┬────────┘  │    │  │
│  │  │         │                                   │           │    │  │
│  │  └─────────┼───────────────────────────────────┼───────────┘    │  │
│  │            │                                   │                │  │
│  │  ┌─────────▼───────────────────────────────────▼───────────┐    │  │
│  │  │                COCKPIT API LAYER                        │    │  │
│  │  │                                                         │    │  │
│  │  │  cockpit.spawn()  cockpit.file()  cockpit.dbus()        │    │  │
│  │  │       │                │               │                │    │  │
│  │  └───────┼────────────────┼───────────────┼────────────────┘    │  │
│  │          │                │               │                     │  │
│  └──────────┼────────────────┼───────────────┼─────────────────────┘  │
│             │                │               │                        │
└─────────────┼────────────────┼───────────────┼────────────────────────┘
              │                │               │
              ▼                ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         LINUX SERVER                                 │
│                                                                      │
│   Shell Commands          Files              Systemd/D-Bus          │
│   (bash, etc.)            (/etc, /var)       (services, etc.)       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

              │
              │ HTTPS (from browser)
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL AI PROVIDERS                           │
│                                                                      │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │
│  │    OpenAI     │  │   Anthropic   │  │    Google     │            │
│  │               │  │               │  │    Gemini     │            │
│  │ api.openai.com│  │api.anthropic. │  │generativelang │            │
│  │               │  │    com        │  │uage.google... │            │
│  └───────────────┘  └───────────────┘  └───────────────┘            │
│                                                                      │
│  ┌───────────────────────────────────────────────────────┐          │
│  │              Custom / Self-Hosted                      │          │
│  │         (Ollama, vLLM, OpenRouter, etc.)              │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. AI Client Manager

Unified interface for multiple AI providers:

```javascript
// Providers configuration
const PROVIDERS = {
  openai: {
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    endpoint: "/chat/completions",
    requestFormat: "openai"
  },
  anthropic: {
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    authHeader: "x-api-key",
    authPrefix: "",
    endpoint: "/v1/messages",
    requestFormat: "anthropic"
  },
  gemini: {
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    models: ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"],
    authHeader: null, // Uses query param
    authPrefix: "",
    endpoint: "/v1beta/models/{model}:generateContent",
    requestFormat: "gemini"
  },
  custom: {
    name: "Custom/OpenAI-Compatible",
    defaultBaseUrl: "",
    models: [],
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    endpoint: "/chat/completions",
    requestFormat: "openai"
  }
};
```

### 2. Command Parser

Extracts structured actions from AI responses:

```javascript
// AI responds with structured commands
const AI_RESPONSE_FORMAT = {
  thought: "I need to check disk usage to answer the user's question",
  actions: [
    {
      type: "command",
      command: "df -h",
      description: "Check disk space usage",
      risk_level: "low"  // low, medium, high, critical
    },
    {
      type: "file_read",
      path: "/etc/fstab",
      description: "Read filesystem configuration"
    }
  ],
  response: "Let me check your disk usage..." // Message to user
};
```

### 3. Approval Manager

Handles user consent before command execution:

```
┌─────────────────────────────────────────────────────────────────┐
│                     APPROVAL FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   AI Response ──► Parse Actions ──► Risk Assessment             │
│                                            │                    │
│                         ┌──────────────────┴──────────────────┐ │
│                         │                                     │ │
│                         ▼                                     ▼ │
│                   YOLO Mode ON?                         YOLO OFF│
│                         │                                     │ │
│              ┌──────────┴──────────┐                          │ │
│              │                     │                          │ │
│              ▼                     ▼                          ▼ │
│         Risk: Low            Risk: High              Show Approval│
│         Auto-execute         Still prompt            Dialog      │
│                                                                 │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              APPROVAL DIALOG                            │   │
│   │                                                         │   │
│   │  "The AI wants to execute:"                            │   │
│   │  ┌───────────────────────────────────────────────────┐  │   │
│   │  │ $ systemctl restart nginx                         │  │   │
│   │  └───────────────────────────────────────────────────┘  │   │
│   │                                                         │   │
│   │  Risk Level: ⚠️ MEDIUM                                  │   │
│   │  Reason: Restarting nginx will cause brief downtime     │   │
│   │                                                         │   │
│   │  [✓ Approve]  [✓ Approve All]  [✗ Deny]  [Edit & Run]  │   │
│   │                                                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Risk Levels:**
- **Low**: Read-only commands (`ls`, `cat`, `df`, `ps`, etc.) - auto-approved in YOLO mode
- **Medium**: Service management, package installation - requires approval
- **High**: File deletion, system configuration changes - always requires approval
- **Critical**: `rm -rf`, disk operations, security changes - always requires explicit approval, even in YOLO mode

### 4. Terminal Output View

Live command output using Cockpit's spawn capabilities:

```javascript
// Using cockpit.spawn for live output
function executeCommand(cmd) {
  const proc = cockpit.spawn(["bash", "-c", cmd], {
    pty: true,       // Use PTY for interactive commands
    environ: ["TERM=xterm-256color"],
    directory: currentDirectory
  });
  
  proc.stream(output => {
    appendToTerminal(output);
  });
  
  return proc;
}
```

---

## File Structure

```
cockpit-ai-agent/
├── manifest.json              # Cockpit plugin manifest
├── index.html                 # Main plugin page
├── dist/                      # Built assets
│   ├── index.js              # Main bundled JS
│   └── index.css             # Compiled CSS
├── src/
│   ├── index.js              # Entry point
│   ├── components/
│   │   ├── App.jsx           # Main application component
│   │   ├── ChatPanel.jsx     # Chat interface
│   │   ├── TerminalView.jsx  # Terminal output display
│   │   ├── ApprovalDialog.jsx # Command approval modal
│   │   └── SettingsPanel.jsx # Configuration UI
│   ├── lib/
│   │   ├── ai-client.js      # Multi-provider AI client
│   │   ├── providers/
│   │   │   ├── openai.js
│   │   │   ├── anthropic.js
│   │   │   └── gemini.js
│   │   ├── agent.js          # Agent controller logic
│   │   ├── command-parser.js # Parse AI responses
│   │   ├── risk-assessor.js  # Evaluate command risk
│   │   └── cockpit-api.js    # Cockpit API wrapper
│   └── styles/
│       └── main.css
├── package.json
├── vite.config.js            # Build configuration
└── README.md
```

---

## Data Flow

### User Message Flow

```
1. User types: "Check what's using the most disk space"
                              │
                              ▼
2. Agent sends to AI with system prompt + context
   {
     system: "You are a Linux system administrator...",
     messages: [...history, userMessage],
     context: {
       currentDir: "/home/user",
       hostname: "server1",
       os: "Ubuntu 24.04"
     }
   }
                              │
                              ▼
3. AI responds with structured actions:
   {
     thought: "I'll check disk usage by directory",
     actions: [
       { type: "command", command: "du -sh /* 2>/dev/null | sort -hr | head -20" }
     ],
     response: "Let me check the disk usage..."
   }
                              │
                              ▼
4. Command flows through approval:
   - YOLO + Low Risk → Auto-execute
   - Otherwise → Show approval dialog
                              │
                              ▼
5. Execute via cockpit.spawn() → Stream output to terminal
                              │
                              ▼
6. Send output back to AI for interpretation
                              │
                              ▼
7. AI provides summary: "The /var directory is using 45GB..."
```

---

## Settings Storage

Settings stored in browser localStorage with optional export/import:

```javascript
const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",           // Encrypted in storage
  model: "gpt-4o",
  baseUrl: "",          // Empty = use provider default
  
  // Behavior settings
  yoloMode: false,
  autoApproveReadOnly: true,
  maxTokens: 4096,
  temperature: 0.7,
  
  // UI settings
  theme: "system",      // system, light, dark
  terminalFontSize: 14,
  
  // Safety settings  
  alwaysConfirmCritical: true,
  commandBlocklist: ["rm -rf /", ":(){ :|:& };:"],
  
  // Audit
  logCommands: true
};
```

---

## System Prompt Template

```markdown
You are an AI assistant integrated into Cockpit, helping administrators manage a Linux server.

## Current Context
- Hostname: {{hostname}}
- OS: {{os_info}}
- Current directory: {{cwd}}
- User: {{user}}
- Uptime: {{uptime}}

## Response Format
You MUST respond with valid JSON in this exact format:
{
  "thought": "Your internal reasoning about the task",
  "actions": [
    {
      "type": "command",
      "command": "the shell command to run",
      "description": "what this command does",
      "risk_level": "low|medium|high|critical"
    }
  ],
  "response": "Your message to the user explaining what you're doing"
}

## Action Types
- command: Execute a shell command
- file_read: Read file contents
- file_write: Write to a file
- service: Manage systemd service

## Risk Levels
- low: Read-only, non-destructive (ls, cat, df, ps, etc.)
- medium: Service management, installations
- high: Configuration changes, file modifications
- critical: Deletions, security changes, dangerous operations

## Guidelines
1. Be concise but thorough
2. Explain what you're doing before doing it
3. Prefer safe, reversible operations
4. Always specify accurate risk levels
5. For multi-step tasks, execute one step at a time
6. If unsure, ask for clarification
```

---

## Security Considerations

1. **API Keys**: Stored encrypted in localStorage, never sent to server
2. **Command Blocklist**: Prevent obviously dangerous commands
3. **Audit Logging**: Optional command history for review
4. **Risk Assessment**: AI-provided + heuristic-based risk levels
5. **Critical Command Lock**: Even YOLO mode prompts for critical operations
6. **CORS**: AI API calls made from browser (provider must allow CORS or use proxy)

---

## Open Questions

1. **CORS Issue**: Some AI providers (Anthropic) don't support browser CORS. Options:
   - A) Run a small proxy server on the Cockpit host
   - B) Use cockpit.http to make requests through Cockpit's backend
   - C) Only support CORS-friendly providers (OpenAI, Gemini)

2. **Session Persistence**: Should chat history persist across browser sessions?

3. **Multi-server**: Should the plugin support connecting to multiple Cockpit servers?

4. **PTY Handling**: Full terminal emulator (xterm.js) or simpler output display?

---

## Tech Stack

- **Build Tool**: Vite (fast, modern)
- **UI Framework**: React (or vanilla JS if preferred)
- **Terminal**: xterm.js for terminal rendering
- **Styling**: PatternFly (Cockpit's design system) or custom CSS
- **Bundling**: Single JS file for Cockpit compatibility
