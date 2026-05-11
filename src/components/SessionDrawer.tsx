/*
 * SessionDrawer - Slide-out panel for chat session history
 */

import React, { useMemo } from "react";
import { Button, Flex, FlexItem } from "@patternfly/react-core";
import {
  TimesIcon,
  PlusIcon,
  TrashIcon,
  CommentIcon,
} from "@patternfly/react-icons";
import type { SessionMetadata } from "../lib/types";
import {
  DEFAULT_SESSION_TITLE,
  groupSessionsByDate,
  formatRelativeTime,
} from "../lib/sessions";
import { useI18n } from "../lib/i18n";

interface SessionDrawerProps {
  isOpen: boolean;
  sessions: SessionMetadata[];
  currentSessionId: string | null;
  onClose: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export const SessionDrawer: React.FC<SessionDrawerProps> = ({
  isOpen,
  sessions,
  currentSessionId,
  onClose,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}) => {
  const { t } = useI18n();
  const _ = t;

  // Group sessions by date
  const groupedSessions = useMemo(() => {
    return groupSessionsByDate(sessions);
  }, [sessions]);

  // Order of groups to display
  const groupOrder = ["Today", "Yesterday", "This Week", "Older"];

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="session-drawer__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="session-drawer">
        <div className="session-drawer__header">
          <Flex
            justifyContent={{ default: "justifyContentSpaceBetween" }}
            alignItems={{ default: "alignItemsCenter" }}
          >
            <FlexItem>
              <h3 className="session-drawer__title">{_("Chat History")}</h3>
            </FlexItem>
            <FlexItem>
              <Button
                variant="plain"
                aria-label={_("Close drawer")}
                onClick={onClose}
                className="session-drawer__close"
              >
                <TimesIcon />
              </Button>
            </FlexItem>
          </Flex>
        </div>

        <div className="session-drawer__actions">
          <Button
            variant="secondary"
            icon={<PlusIcon />}
            onClick={onNewSession}
            isBlock
            className="session-drawer__new-btn"
          >
            {_("New Chat")}
          </Button>
        </div>

        <div className="session-drawer__list">
          {sessions.length === 0 ? (
            <div className="session-drawer__empty">
              <CommentIcon className="session-drawer__empty-icon" />
              <p>{_("No chat history yet")}</p>
              <small>{_("Start a conversation to see it here")}</small>
            </div>
          ) : (
            groupOrder.map((group) => {
              const groupSessions = groupedSessions.get(group);
              if (!groupSessions || groupSessions.length === 0) return null;

              return (
                <div key={group} className="session-group">
                  <div className="session-group__header">{_(group)}</div>
                  {groupSessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isActive={session.id === currentSessionId}
                      onSelect={() => onSelectSession(session.id)}
                      onDelete={() => onDeleteSession(session.id)}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

// Individual session item
const SessionItem: React.FC<{
  session: SessionMetadata;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}> = ({ session, isActive, onSelect, onDelete }) => {
  const { t } = useI18n();
  const _ = t;
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  return (
    <div
      className={`session-item ${isActive ? "session-item--active" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect();
        }
      }}
    >
      <div className="session-item__content">
        <div
          className="session-item__title"
          title={
            session.title === DEFAULT_SESSION_TITLE
              ? _("New Chat")
              : session.title
          }
        >
          {session.title === DEFAULT_SESSION_TITLE
            ? _("New Chat")
            : session.title}
        </div>
        <div className="session-item__meta">
          <span className="session-item__time">
            {formatRelativeTime(session.updatedAt, _)}
          </span>
          <span className="session-item__count">
            {session.messageCount}{" "}
            {session.messageCount === 1 ? _("message") : _("messages")}
          </span>
        </div>
      </div>
      <button
        className="session-item__delete"
        onClick={handleDelete}
        aria-label={_("Delete session")}
        title={_("Delete")}
      >
        <TrashIcon />
      </button>
    </div>
  );
};

export default SessionDrawer;
