import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type Language = "en" | "zh-CN";

export interface TranslateVars {
  [key: string]: string | number;
}

export type TranslateFn = (key: string, vars?: TranslateVars) => string;

export const DEFAULT_LANGUAGE: Language = "en";

export const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

const ZH_CN_TRANSLATIONS: Record<string, string> = {
  Agent: "助手",
  "loading...": "加载中...",
  "Chat History": "聊天历史",
  "Chat History (Ctrl+H)": "聊天历史（Ctrl+H）",
  "Toggle Debug Panel": "切换调试面板",
  "Switch to dark mode": "切换到深色模式",
  "Switch to light mode": "切换到浅色模式",
  Settings: "设置",
  "Resize panels": "调整面板大小",

  Paranoid: "偏执",
  "All commands require approval": "所有命令都需要批准",
  Cautious: "谨慎",
  "Auto-run read-only commands": "自动运行只读命令",
  Moderate: "适中",
  "Auto-run low & medium risk": "自动运行低风险和中风险操作",
  YOLO: "YOLO",
  "Auto-run most, confirm critical": "自动运行大多数操作，关键操作仍需确认",
  "Full YOLO": "完全 YOLO",
  "Auto-run everything (dangerous!)": "自动运行所有操作（危险！）",
  "OpenAI API or compatible endpoints (Ollama, Azure, etc.)":
    "OpenAI API 或兼容端点（Ollama、Azure 等）",
  "Google AI Studio Gemini models": "Google AI Studio Gemini 模型",

  "Welcome to Cockpit Agent": "欢迎使用 Cockpit 助手",
  "Your AI-powered terminal assistant for server administration":
    "面向服务器管理的 AI 终端助手",
  "Natural Language Interface": "自然语言界面",
  "Just describe what you want to do in plain English":
    "只需用自然语言描述你想执行的操作",
  "Safety Controls": "安全控制",
  "Command approval and risk assessment before execution":
    "执行前进行命令批准与风险评估",
  "Secret Protection": "敏感信息保护",
  "Automatic detection and redaction of sensitive data":
    "自动检测并隐藏敏感数据",
  "Let's get you set up in just a few steps.": "只需几个步骤即可完成设置。",
  "Configure AI Provider": "配置 AI 提供商",
  "Choose your AI provider and enter your API credentials":
    "选择你的 AI 提供商并输入 API 凭据",
  Provider: "提供商",
  "API Key": "API 密钥",
  "Hide API key": "隐藏 API 密钥",
  "Show API key": "显示 API 密钥",
  "Get your OpenAI API key →": "获取 OpenAI API 密钥 →",
  "Get your Google AI Studio key →": "获取 Google AI Studio 密钥 →",
  "Enter your API key from your provider": "输入你的提供商 API 密钥",
  Model: "模型",
  "Use preset models": "使用预设模型",
  "Use custom model": "使用自定义模型",
  "Base URL": "基础 URL",
  "Optional: Override for proxies or local deployments (e.g., Ollama)":
    "可选：用于代理或本地部署的覆盖地址（例如 Ollama）",
  "Choose Your Safety Level": "选择安全级别",
  "Select how much automation you want. You can change this anytime in settings.":
    "选择你希望自动化的程度。你可以随时在设置中更改。",
  "⚠️ Full YOLO Mode": "⚠️ 完全 YOLO 模式",
  "All commands will auto-execute including destructive ones like 'rm -rf'. Only use this if you fully trust the AI and accept all risks.":
    "所有命令都会自动执行，包括像 rm -rf 这样的破坏性命令。只有在你完全信任 AI 并愿意承担全部风险时才应使用。",
  "We recommend ": "我们建议大多数用户使用 ",
  " mode for most users. It auto-runs safe read-only commands while requiring approval for anything that modifies your system.":
    " 模式。它会自动运行安全的只读命令，同时对任何会修改系统的操作请求批准。",
  "Important Disclaimer": "重要免责声明",
  "Please read and accept the following before using the Agent":
    "在使用助手之前，请阅读并接受以下内容",
  "No Warranty": "无担保",
  'This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement.':
    "本软件按“原样”提供，不附带任何形式的明示或暗示担保，包括但不限于适销性、特定用途适用性和非侵权担保。",
  "Limitation of Liability": "责任限制",
  "In no event shall the authors, contributors, or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.":
    "无论基于合同、侵权或其他原因，作者、贡献者或版权持有人均不对因本软件或其使用而产生的任何索赔、损害或其他责任负责。",
  "User Responsibility": "用户责任",
  "You are solely responsible for all commands executed on your system. AI-generated commands may be incorrect, incomplete, or harmful. Always review commands before execution, especially in production environments.":
    "你需要对系统上执行的所有命令承担全部责任。AI 生成的命令可能不正确、不完整或有害。请务必在执行前检查命令，尤其是在生产环境中。",
  "Data Handling": "数据处理",
  "Your prompts and command outputs may be sent to third-party AI providers (OpenAI, Google, etc.) for processing. While we redact detected secrets, you should never input highly sensitive information. Review your provider's data handling policies.":
    "你的提示词和命令输出可能会发送给第三方 AI 提供商（OpenAI、Google 等）进行处理。虽然我们会隐藏检测到的敏感信息，但你仍不应输入高度敏感的数据。请查看你的提供商数据处理政策。",
  "I have read and understand the above disclaimer. I accept full responsibility for my use of this software and any commands executed on my system.":
    "我已阅读并理解上述免责声明。我愿意对使用本软件以及在我的系统上执行的任何命令承担全部责任。",
  Step: "步骤",
  of: "共",
  Back: "返回",
  "Get Started": "开始使用",
  Continue: "继续",
  "Please enter an API key to continue": "请输入 API 密钥以继续",
  "Please accept the terms to continue": "请接受条款后继续",
  "Failed to save settings. Please try again.": "保存设置失败，请重试。",
  Language: "语言",
  "Choose the interface language used throughout the app.":
    "选择整个应用界面使用的语言。",
  English: "English",
  "Simplified Chinese": "简体中文",

  Behavior: "行为",
  Security: "安全",
  Developer: "开发者",
  About: "关于",
  "Automation Level": "自动化级别",
  "Dangerous mode": "危险模式",
  "All commands will auto-execute including destructive ones. Use only if you fully trust the AI.":
    "所有命令都会自动执行，包括破坏性命令。仅在你完全信任 AI 时使用。",
  Temperature: "温度",
  "Lower = focused and deterministic, higher = creative and varied":
    "越低越专注且确定，越高越有创造性且变化更多",
  "Max Tokens": "最大令牌数",
  "Maximum length of AI responses": "AI 响应的最大长度",
  "Output Truncate Length": "输出截断长度",
  "Max characters of command output sent to AI (higher = more context, more tokens)":
    "发送给 AI 的命令输出最大字符数（越高 = 上下文越多，令牌消耗越多）",
  "Max Execution Steps": "最大执行步数",
  "Maximum action-loop iterations per request before the agent stops (prevents runaway tasks)":
    "每次请求允许的最大动作循环次数，达到后代理会停止（防止任务失控）",
  "Stream AI responses": "流式显示 AI 响应",
  "Show the assistant's response as it is generated (recommended)":
    "在生成过程中实时显示助手响应（推荐）",
  "Restore last session on startup": "启动时恢复上次会话",
  "When disabled, opening the app always starts a new chat session":
    "关闭后，每次打开应用都会创建一个新的聊天会话",
  "Redact secrets": "隐藏敏感信息",
  "Automatically mask passwords, API keys, and tokens before sending to AI":
    "在发送给 AI 之前自动遮蔽密码、API 密钥和令牌",
  "Secrets exposed": "敏感信息已暴露",
  "Sensitive data will be visible to the AI provider.":
    "敏感数据将对 AI 提供商可见。",
  "Blocked Patterns": "拦截规则",
  "These commands are always blocked regardless of safety mode":
    "这些命令无论安全模式如何都会被阻止",
  "Log executed commands": "记录已执行命令",
  "Keep a record of all commands executed by the AI":
    "保留 AI 执行的所有命令记录",
  "Debug mode": "调试模式",
  "Enable verbose console logging and debug panel":
    "启用详细控制台日志和调试面板",
  "Restart Onboarding": "重新开始引导",
  "Re-run the setup wizard (for testing purposes)":
    "重新运行设置向导（用于测试）",
  "An AI-powered terminal assistant for server administration. Chat with an AI that can execute commands, manage services, and help troubleshoot your Linux servers directly through Cockpit.":
    "面向服务器管理的 AI 终端助手。你可以通过 Cockpit 与能够执行命令、管理服务并协助排查 Linux 服务器问题的 AI 对话。",
  "GitHub Repository": "GitHub 仓库",
  License: "许可证",
  Disclaimer: "免责声明",
  'This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors are not liable for any damages or issues arising from the use of this software. Use at your own risk. Always review commands before execution, especially in production environments.':
    "本软件按“原样”提供，不附带任何形式的明示或暗示担保。作者和贡献者不对因使用本软件而产生的任何损害或问题负责。请自行承担使用风险。执行命令前请务必审查，尤其是在生产环境中。",
  "Settings navigation": "设置导航",
  Save: "保存",
  Cancel: "取消",
  Close: "关闭",

  "Configure your AI provider to get started. You'll need an API key from OpenAI, Google Gemini, or a custom provider.":
    "请先配置你的 AI 提供商。你需要提供 OpenAI、Google Gemini 或自定义提供商的 API 密钥。",
  "How can I help you today?": "今天我可以帮你做什么？",
  "Ask me to run commands, check system status, or troubleshoot issues.":
    "你可以让我执行命令、检查系统状态或排查问题。",
  "Check system storage": "检查系统存储",
  "Update Docker containers": "更新 Docker 容器",
  "Network info": "网络信息",
  "Check security logs": "检查安全日志",
  "Thinking...": "思考中...",
  "Ask me to help manage this server...": "让我帮你管理这台服务器...",
  "Message input": "消息输入",
  "Stop response": "停止响应",
  "Send message": "发送消息",
  line: "行",
  lines: "行",
  chars: "字符",
  Approve: "批准",
  Deny: "拒绝",
  "Content to Write": "待写入内容",
  "Critical operation - review carefully": "关键操作，请仔细检查",
  "Running... (watch the terminal for live output)":
    "运行中...（请查看终端中的实时输出）",
  "Content Written": "已写入内容",
  "Content Read": "已读取内容",
  "Interactive Command": "交互式命令",
  "Thought Process": "思考过程",

  "Close drawer": "关闭抽屉",
  "New Chat": "新聊天",
  "No chat history yet": "还没有聊天历史",
  "Start a conversation to see it here": "开始对话后会显示在这里",
  Today: "今天",
  Yesterday: "昨天",
  "This Week": "本周",
  Older: "更早",
  message: "条消息",
  messages: "条消息",
  "Delete session": "删除会话",
  Delete: "删除",
  "Just now": "刚刚",
  "{count}m ago": "{count} 分钟前",
  "{count}h ago": "{count} 小时前",
  "{count}d ago": "{count} 天前",

  "Detected Secrets": "检测到的敏感信息",
  "These values are hidden from the AI but can be used in commands via their placeholder IDs.":
    "这些值对 AI 不可见，但可以通过占位符 ID 在命令中使用。",
  "No secrets detected yet. Sensitive data like passwords and API keys will appear here.":
    "尚未检测到敏感信息。密码和 API 密钥等敏感数据会显示在这里。",
  Secrets: "敏感信息",
  "Clear all secrets": "清除所有敏感信息",
  "Detected secrets": "检测到的敏感信息",
  "{count} secrets detected": "已检测到 {count} 条敏感信息",
  "Bearer Token": "Bearer 令牌",
  "JWT Token": "JWT 令牌",
  "AWS Access Key": "AWS 访问密钥",
  "AWS Secret Key": "AWS 密钥",
  "Private Key": "私钥",
  "Database Password": "数据库密码",
  Password: "密码",
  "GitHub Token": "GitHub 令牌",
  "GitHub OAuth": "GitHub OAuth",
  "GitLab Token": "GitLab 令牌",
  "Slack Token": "Slack 令牌",
  "Hex Secret": "十六进制密钥",
  "Base64 Secret": "Base64 密钥",
  "SSH Password": "SSH 密码",
  "Sudo Password": "Sudo 密码",
  "User Secret": "用户自定义密钥",

  Terminal: "终端",
  "Clear terminal": "清空终端",
  "Terminal not ready": "终端尚未就绪",

  "Low Risk": "低风险",
  "Medium Risk": "中风险",
  "High Risk": "高风险",
  Critical: "严重",
  "Read: {path}": "读取：{path}",
  "Write: {path}": "写入：{path}",
  "AI wants to execute:": "AI 想要执行：",
  "This is a critical operation that could cause data loss or system damage.":
    "这是一个关键操作，可能导致数据丢失或系统损坏。",
  "Execute Anyway": "仍然执行",

  "Authentication Failed": "身份验证失败",
  "Rate Limited": "触发速率限制",
  "Server Error": "服务器错误",
  "Connection Failed": "连接失败",
  "API Request Failed": "API 请求失败",
  "The API key may be invalid or expired. Please check your settings.":
    "API 密钥可能无效或已过期，请检查你的设置。",
  "Too many requests. Please wait a moment and try again.":
    "请求过多，请稍候再试。",
  "The AI provider is experiencing issues. Please try again later.":
    "AI 提供商当前出现问题，请稍后再试。",
  "Unable to connect to the AI provider. Please check your network connection.":
    "无法连接到 AI 提供商，请检查网络连接。",
  "An unexpected error occurred while communicating with the AI provider.":
    "与 AI 提供商通信时发生了意外错误。",
  "Connection failed after {attemptsMade} attempts (max {maxRetries} retries with exponential backoff).":
    "连接在尝试 {attemptsMade} 次后失败（最多重试 {maxRetries} 次，采用指数退避）。",
  "Hide technical details": "隐藏技术细节",
  "Show technical details": "显示技术细节",
  "Provider:": "提供商：",
  "Endpoint:": "端点：",
  "Status Code:": "状态码：",
  "Attempts:": "尝试次数：",
  "Last Attempt:": "最后一次尝试：",
  "Error Message:": "错误信息：",
  Retry: "重试",
  Dismiss: "关闭",
};

const TRANSLATIONS: Record<Language, Record<string, string>> = {
  en: {},
  "zh-CN": ZH_CN_TRANSLATIONS,
};

function applyVars(template: string, vars?: TranslateVars): string {
  if (!vars) {
    return template;
  }

  return Object.entries(vars).reduce((result, [key, value]) => {
    return result.split(`{${key}}`).join(String(value));
  }, template);
}

export function translate(
  language: Language,
  key: string,
  vars?: TranslateVars,
): string {
  const template = TRANSLATIONS[language]?.[key] ?? key;
  return applyVars(template, vars);
}

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: TranslateFn;
  languages: Array<{ value: Language; label: string }>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  initialLanguage?: Language;
  children: React.ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  initialLanguage = DEFAULT_LANGUAGE,
  children,
}) => {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  const t = useCallback<TranslateFn>(
    (key, vars) => translate(language, key, vars),
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t,
      languages: [
        { value: "en", label: translate(language, "English") },
        { value: "zh-CN", label: translate(language, "Simplified Chinese") },
      ],
    }),
    [language, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
