<div align="center">
  <img src="logo-text.png" alt="Cockpit Agent Logo" width="450" />
  
  <h3>An AI-powered terminal assistant plugin for <a href="https://cockpit-project.org/">Cockpit</a>, the web-based Linux server management interface.</h3>

  <p>
    <img src="https://img.shields.io/badge/version-1.0.0-ab69d3?style=for-the-badge" alt="Version 1.0.0" />
    <img src="https://img.shields.io/badge/license-LGPL--2.1-ab69d3?style=for-the-badge" alt="License LGPL 2.1" />
  </p>
</div>

---

## Features

- 🤖 **AI-Powered Terminal Assistant** - Natural language interface for server administration
- 🔧 **Multi-Provider Support** - OpenAI, Google Gemini, or any OpenAI-compatible endpoint
- ⚡ **YOLO Mode** - Auto-execute low-risk commands for faster workflows
- 🔒 **Safety First** - Command approval system with risk levels and blocklist
- 🎨 **Native Cockpit UI** - Built with PatternFly for seamless integration
- 💻 **Full Terminal Emulation** - xterm.js for interactive commands (sudo, etc.)

## Screenshots

*Coming soon*

## Installation

### Prerequisites

- Cockpit installed on your Linux server
- Node.js 18+ (for development)
- npm

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/cockpit-ai-agent.git
cd cockpit-ai-agent

# Install dependencies
npm install

# Build the plugin
npm run build

# Link for development (symlink to ~/.local/share/cockpit)
mkdir -p ~/.local/share/cockpit
ln -s $(pwd)/dist ~/.local/share/cockpit/cockpit-ai-agent

# Restart Cockpit or refresh your browser
```

### Watch Mode (Development)

```bash
npm run watch
```

This will automatically rebuild on file changes.

### Production Build

```bash
NODE_ENV=production npm run build
```

### System-Wide Installation

```bash
sudo cp -r dist /usr/share/cockpit/cockpit-ai-agent
```

## Configuration

1. Access Cockpit in your browser (usually `https://your-server:9090`)
2. Navigate to **AI Agent** in the sidebar
3. Click the ⚙️ settings button
4. Configure your AI provider:

| Provider | API Key Source | Notes |
|----------|---------------|-------|
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | Supports GPT-4o, GPT-4-turbo, etc. |
| **Google Gemini** | [AI Studio](https://makersuite.google.com/app/apikey) | Supports Gemini 2.0, 1.5 Pro/Flash |
| **Custom** | Your provider | Any OpenAI-compatible API |

## Usage

### Basic Commands

Simply type what you want to do in natural language:

- "Check disk space usage"
- "Show me the last 50 lines of /var/log/syslog"
- "Restart nginx"
- "What services are failing?"
- "Install htop"

### YOLO Mode

Enable YOLO mode in settings to auto-execute **low-risk** commands (read-only operations like `ls`, `df`, `ps`, etc.) without prompts.

⚠️ **Critical commands always require approval**, even in YOLO mode.

### Risk Levels

| Level | Examples | Approval |
|-------|----------|----------|
| 🟢 **Low** | `ls`, `cat`, `df`, `ps` | Auto in YOLO |
| 🟡 **Medium** | `systemctl restart`, `apt install` | Always required |
| 🔴 **High** | Config changes, user management | Always required |
| ☠️ **Critical** | `rm -rf`, disk operations | Always required + warning |

## Architecture

```
┌─────────────────────────────────────────┐
│          Cockpit Web Interface          │
├─────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────┐   │
│  │  Chat Panel │  │  Terminal View  │   │
│  │             │  │   (xterm.js)    │   │
│  └──────┬──────┘  └────────▲────────┘   │
│         │                  │            │
│  ┌──────▼──────────────────┴──────┐     │
│  │        Agent Controller        │     │
│  │  • AI Client (multi-provider)  │     │
│  │  • Command Parser              │     │
│  │  • Approval Manager            │     │
│  └───────────────┬────────────────┘     │
│                  │                      │
│  ┌───────────────▼────────────────┐     │
│  │      Cockpit API Layer         │     │
│  │  cockpit.spawn() / file()      │     │
│  └────────────────────────────────┘     │
└─────────────────────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │ Linux Server │
    └──────────────┘
```

## Project Structure

```
cockpit-ai-agent/
├── src/
│   ├── app.tsx                 # Main application component
│   ├── index.tsx               # Entry point
│   ├── app.scss                # Custom styles
│   ├── components/
│   │   ├── ChatPanel.tsx       # Chat interface
│   │   ├── TerminalView.tsx    # xterm.js terminal
│   │   ├── SettingsModal.tsx   # Configuration modal
│   │   └── ApprovalModal.tsx   # Command approval dialog
│   └── lib/
│       ├── ai-client.ts        # Multi-provider AI client
│       ├── agent.ts            # Agent controller
│       ├── settings.ts         # Settings management
│       └── types.ts            # TypeScript types
├── dist/                       # Built plugin (generated)
├── package.json
├── build.js                    # esbuild configuration
└── README.md
```

## Supported AI Providers

### OpenAI
- Models: GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo, o1-preview, o1-mini
- Endpoint: `https://api.openai.com/v1`

### Google Gemini
- Models: Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash
- Endpoint: `https://generativelanguage.googleapis.com`

### Custom (OpenAI-Compatible)
- Works with: Ollama, vLLM, OpenRouter, Azure OpenAI, etc.
- Configure your own base URL and model name

## Safety Features

1. **Command Blocklist** - Dangerous patterns are blocked automatically:
   - `rm -rf /`
   - Fork bombs
   - Disk formatting commands

2. **Risk Assessment** - AI assigns risk levels to each command

3. **Approval Flow** - Review commands before execution

4. **Audit Logging** - Optional command history

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the LGPL-2.1 License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Cockpit Project](https://cockpit-project.org/) for the excellent server management platform
- [PatternFly](https://www.patternfly.org/) for the React component library
- [xterm.js](https://xtermjs.org/) for terminal emulation
