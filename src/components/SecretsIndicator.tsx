/*
 * SecretsIndicator - Shows detected secrets count and list
 */

import React, { useState } from "react";
import {
  Button,
  Popover,
  Label,
  LabelGroup,
  Content,
  ContentVariants,
  Divider,
  EmptyState,
  EmptyStateBody,
} from "@patternfly/react-core";
import { KeyIcon, TrashIcon, ShieldAltIcon } from "@patternfly/react-icons";
import { useI18n } from "../lib/i18n";

interface DetectedSecret {
  id: string;
  type: string;
  detectedAt: Date;
}

interface SecretsIndicatorProps {
  secrets: DetectedSecret[];
  onClear: () => void;
  isEnabled: boolean;
}

// Map secret types to friendly names
const SECRET_TYPE_NAMES: Record<string, string> = {
  api_key: "API Key",
  bearer_token: "Bearer Token",
  jwt_token: "JWT Token",
  aws_access_key: "AWS Access Key",
  aws_secret_key: "AWS Secret Key",
  private_key: "Private Key",
  db_connection: "Database Password",
  password_field: "Password",
  github_token: "GitHub Token",
  github_oauth: "GitHub OAuth",
  gitlab_token: "GitLab Token",
  slack_token: "Slack Token",
  high_entropy_hex: "Hex Secret",
  high_entropy_base64: "Base64 Secret",
  ssh_pass: "SSH Password",
  sudo_pass: "Sudo Password",
  user_defined: "User Secret",
};

export const SecretsIndicator: React.FC<SecretsIndicatorProps> = ({
  secrets,
  onClear,
  isEnabled,
}) => {
  const { t } = useI18n();
  const _ = t;
  const [isOpen, setIsOpen] = useState(false);

  if (!isEnabled) {
    return null;
  }

  const secretCount = secrets.length;

  const getTypeName = (type: string) => _(SECRET_TYPE_NAMES[type] || type);

  const popoverContent = (
    <div style={{ minWidth: "280px", maxWidth: "400px" }}>
      <div style={{ marginBottom: "12px" }}>
        <Content
          component={ContentVariants.h4}
          style={{ margin: 0, display: "flex", alignItems: "center" }}
        >
          <ShieldAltIcon style={{ marginRight: "8px" }} />
          {_("Detected Secrets")}
        </Content>
        <Content component={ContentVariants.small} style={{ color: "#6a6e73" }}>
          {_(
            "These values are hidden from the AI but can be used in commands via their placeholder IDs.",
          )}
        </Content>
      </div>

      {secretCount === 0 ? (
        <EmptyState>
          <EmptyStateBody>
            {_(
              "No secrets detected yet. Sensitive data like passwords and API keys will appear here.",
            )}
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <>
          <LabelGroup categoryName={_("Secrets")}>
            {secrets.map((secret) => (
              <Label key={secret.id} color="purple" icon={<KeyIcon />}>
                <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
                  {secret.id}
                </span>
                <span
                  style={{ marginLeft: "8px", fontSize: "10px", opacity: 0.8 }}
                >
                  ({getTypeName(secret.type)})
                </span>
              </Label>
            ))}
          </LabelGroup>

          <Divider style={{ margin: "12px 0" }} />

          <Button
            variant="link"
            icon={<TrashIcon />}
            onClick={() => {
              onClear();
              setIsOpen(false);
            }}
            isDanger
            size="sm"
          >
            {_("Clear all secrets")}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Popover
      aria-label={_("Detected secrets")}
      headerContent={null}
      bodyContent={popoverContent}
      isVisible={isOpen}
      shouldClose={() => setIsOpen(false)}
      position="bottom"
      showClose={false}
    >
      <Button
        variant="plain"
        onClick={() => setIsOpen(!isOpen)}
        className={`secrets-indicator ${secretCount > 0 ? "secrets-indicator--active" : ""}`}
        aria-label={_("{count} secrets detected", { count: secretCount })}
      >
        <ShieldAltIcon />
        {secretCount > 0 && (
          <span className="secrets-indicator__count">{secretCount}</span>
        )}
      </Button>
    </Popover>
  );
};
