/*
 * Session management for Cockpit AI Agent
 * Handles chat history persistence
 */

import cockpit from "cockpit";
import type { ChatSession, SessionMetadata, Message } from "./types";
import type { TranslateFn } from "./i18n";

const SESSIONS_DIR = ".config/cockpit-ai-agent/sessions";
const MAX_SESSIONS = 50;

export const DEFAULT_SESSION_TITLE = "New Chat";

// Generate a unique session ID
export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Generate a title from the first user message
export function generateTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (firstUserMessage) {
    // Take first 50 chars, trim at word boundary
    const content = firstUserMessage.content.trim();
    if (content.length <= 50) return content;
    const truncated = content.substring(0, 50);
    const lastSpace = truncated.lastIndexOf(" ");
    return (
      (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + "..."
    );
  }
  return DEFAULT_SESSION_TITLE;
}

// Get the current user's home directory
async function getHomeDir(): Promise<string> {
  try {
    const user = await cockpit.user();
    return user.home;
  } catch (e) {
    try {
      const result = await cockpit.spawn(["sh", "-c", "echo $HOME"], {
        err: "message",
      });
      return (result as string).trim();
    } catch {
      return "/root";
    }
  }
}

// Ensure sessions directory exists
async function ensureSessionsDir(): Promise<string> {
  const homeDir = await getHomeDir();
  const sessionsDir = `${homeDir}/${SESSIONS_DIR}`;
  await cockpit.spawn(["mkdir", "-p", sessionsDir], { err: "ignore" });
  return sessionsDir;
}

// Create a new session
export function createSession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: generateSessionId(),
    title: DEFAULT_SESSION_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Load all session metadata (without full messages)
export async function loadSessionList(): Promise<SessionMetadata[]> {
  try {
    const sessionsDir = await ensureSessionsDir();

    // List all .json files in sessions directory
    const result = await cockpit.spawn(
      ["sh", "-c", `ls -1 "${sessionsDir}"/*.json 2>/dev/null || true`],
      { err: "ignore" },
    );

    const files = (result as string)
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
    const sessions: SessionMetadata[] = [];

    for (const filePath of files) {
      try {
        const file = cockpit.file(filePath);
        const content = await file.read();
        file.close();

        if (content && typeof content === "string") {
          const session = JSON.parse(content) as ChatSession;
          sessions.push({
            id: session.id,
            title: session.title,
            messageCount: session.messages.length,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          });
        }
      } catch (e) {
        console.warn(`Failed to read session file: ${filePath}`, e);
      }
    }

    // Sort by updatedAt descending (most recent first)
    sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return sessions;
  } catch (e) {
    console.error("Failed to load session list:", e);
    return [];
  }
}

// Load a full session by ID
export async function loadSession(id: string): Promise<ChatSession | null> {
  try {
    const sessionsDir = await ensureSessionsDir();
    const filePath = `${sessionsDir}/${id}.json`;

    const file = cockpit.file(filePath);
    const content = await file.read();
    file.close();

    if (content && typeof content === "string") {
      return JSON.parse(content) as ChatSession;
    }
  } catch (e) {
    console.error(`Failed to load session ${id}:`, e);
  }
  return null;
}

// Save a session
export async function saveSession(session: ChatSession): Promise<void> {
  try {
    const sessionsDir = await ensureSessionsDir();
    const filePath = `${sessionsDir}/${session.id}.json`;

    // Update the title if we have messages and title is default
    if (
      session.messages.length > 0 &&
      session.title === DEFAULT_SESSION_TITLE
    ) {
      session.title = generateTitle(session.messages);
    }

    // Update timestamp
    session.updatedAt = new Date().toISOString();

    const file = cockpit.file(filePath);
    await file.replace(JSON.stringify(session, null, 2));
    file.close();

    // Cleanup old sessions if we have too many
    await cleanupOldSessions();
  } catch (e) {
    console.error("Failed to save session:", e);
    throw e;
  }
}

// Delete a session
export async function deleteSession(id: string): Promise<void> {
  try {
    const sessionsDir = await ensureSessionsDir();
    const filePath = `${sessionsDir}/${id}.json`;
    await cockpit.spawn(["rm", "-f", filePath], { err: "ignore" });
  } catch (e) {
    console.error(`Failed to delete session ${id}:`, e);
  }
}

// Remove oldest sessions if we exceed the limit
async function cleanupOldSessions(): Promise<void> {
  try {
    const sessions = await loadSessionList();

    if (sessions.length > MAX_SESSIONS) {
      // Delete oldest sessions (beyond the limit)
      const toDelete = sessions.slice(MAX_SESSIONS);
      for (const session of toDelete) {
        await deleteSession(session.id);
      }
      console.log(`Cleaned up ${toDelete.length} old sessions`);
    }
  } catch (e) {
    console.error("Failed to cleanup old sessions:", e);
  }
}

// Group sessions by date for display
export function groupSessionsByDate(
  sessions: SessionMetadata[],
): Map<string, SessionMetadata[]> {
  const groups = new Map<string, SessionMetadata[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const session of sessions) {
    const sessionDate = new Date(session.updatedAt);
    let group: string;

    if (sessionDate >= today) {
      group = "Today";
    } else if (sessionDate >= yesterday) {
      group = "Yesterday";
    } else if (sessionDate >= weekAgo) {
      group = "This Week";
    } else {
      group = "Older";
    }

    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(session);
  }

  return groups;
}

// Format relative time for display
export function formatRelativeTime(dateStr: string, t?: TranslateFn): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return t ? t("Just now") : "Just now";
  if (diffMins < 60)
    return t ? t("{count}m ago", { count: diffMins }) : `${diffMins}m ago`;
  if (diffHours < 24)
    return t ? t("{count}h ago", { count: diffHours }) : `${diffHours}h ago`;
  if (diffDays < 7)
    return t ? t("{count}d ago", { count: diffDays }) : `${diffDays}d ago`;

  return date.toLocaleDateString();
}
