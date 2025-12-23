/*
 * ApprovalCard - Inline approval component for command execution
 * 
 * Appears in the chat flow instead of as a modal overlay
 */

import React from 'react';
import {
    Card,
    CardBody,
    Button,
    Flex,
    FlexItem,
    Label,
} from "@patternfly/react-core";
import { 
    CheckIcon, 
    TimesIcon, 
    ExclamationTriangleIcon,
    ExclamationCircleIcon,
    ShieldAltIcon,
} from "@patternfly/react-icons";
import cockpit from 'cockpit';

import type { PendingAction } from '../lib/types';

const _ = cockpit.gettext;

interface ApprovalCardProps {
    action: PendingAction;
}

// Risk level configuration
const riskConfig = {
    low: {
        color: 'green' as const,
        label: 'Low Risk',
        icon: ShieldAltIcon,
    },
    medium: {
        color: 'orange' as const,
        label: 'Medium Risk',
        icon: ExclamationTriangleIcon,
    },
    high: {
        color: 'red' as const,
        label: 'High Risk',
        icon: ExclamationTriangleIcon,
    },
    critical: {
        color: 'purple' as const,
        label: 'Critical',
        icon: ExclamationCircleIcon,
    }
};

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ action }) => {
    const config = riskConfig[action.risk_level] || riskConfig.medium;
    const RiskIcon = config.icon;
    const isCritical = action.risk_level === 'critical';

    const getActionDisplay = () => {
        switch (action.type) {
            case 'command':
                return action.command;
            case 'file_read':
                return `Read: ${action.path}`;
            case 'file_write':
                return `Write: ${action.path}`;
            case 'service':
                return `${action.operation} ${action.service}`;
            default:
                return action.description;
        }
    };

    return (
        <div className="approval-card-wrapper">
            <Card className={`approval-card ${action.risk_level}`}>
                <CardBody>
                    {/* Header */}
                    <Flex 
                        justifyContent={{ default: 'justifyContentSpaceBetween' }} 
                        alignItems={{ default: 'alignItemsCenter' }}
                        className="approval-header"
                    >
                        <FlexItem>
                            <span className="approval-title">
                                🤖 {_("AI wants to execute:")}
                            </span>
                        </FlexItem>
                        <FlexItem>
                            <Label color={config.color} icon={<RiskIcon />}>
                                {config.label}
                            </Label>
                        </FlexItem>
                    </Flex>

                    {/* Description */}
                    <div className="approval-description">
                        {action.description}
                    </div>

                    {/* Command display */}
                    <div className="approval-command">
                        <code>{getActionDisplay()}</code>
                    </div>

                    {/* Critical warning */}
                    {isCritical && (
                        <div className="approval-warning">
                            <ExclamationCircleIcon /> {_("This is a critical operation that could cause data loss or system damage.")}
                        </div>
                    )}

                    {/* Action buttons */}
                    <Flex 
                        justifyContent={{ default: 'justifyContentFlexEnd' }} 
                        spaceItems={{ default: 'spaceItemsSm' }}
                        className="approval-actions"
                    >
                        <FlexItem>
                            <Button 
                                variant="link" 
                                onClick={action.onDeny}
                                icon={<TimesIcon />}
                                className="deny-btn"
                            >
                                {_("Deny")}
                            </Button>
                        </FlexItem>
                        <FlexItem>
                            <Button 
                                variant={isCritical ? "danger" : "primary"}
                                onClick={action.onApprove}
                                icon={<CheckIcon />}
                            >
                                {isCritical ? _("Execute Anyway") : _("Approve")}
                            </Button>
                        </FlexItem>
                    </Flex>
                </CardBody>
            </Card>
        </div>
    );
};

// Keep the modal for backwards compatibility but we won't use it
export const ApprovalModal = ApprovalCard;
