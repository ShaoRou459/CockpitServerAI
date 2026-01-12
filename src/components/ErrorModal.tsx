/*
 * ErrorModal - Custom error modal for API failures
 * 
 * Displays after exponential retry attempts have been exhausted
 */

import React from 'react';
import {
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Button,
    Alert,
    Flex,
    FlexItem,
    ExpandableSection,
} from "@patternfly/react-core";
import {
    ExclamationCircleIcon,
    RedoIcon,
} from "@patternfly/react-icons";
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export interface ApiError {
    message: string;
    provider?: string;
    endpoint?: string;
    statusCode?: number | undefined;
    attemptsMade: number;
    maxRetries: number;
    lastAttemptTime?: Date;
}

interface ErrorModalProps {
    isOpen: boolean;
    error: ApiError | null;
    onClose: () => void;
    onRetry?: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
    isOpen,
    error,
    onClose,
    onRetry
}) => {
    if (!error) return null;

    const [isDetailsExpanded, setIsDetailsExpanded] = React.useState(false);

    const getErrorTitle = () => {
        if (error.statusCode === 401 || error.statusCode === 403) {
            return _("Authentication Failed");
        }
        if (error.statusCode === 429) {
            return _("Rate Limited");
        }
        if (error.statusCode && error.statusCode >= 500) {
            return _("Server Error");
        }
        if (error.message.toLowerCase().includes('network') ||
            error.message.toLowerCase().includes('timeout') ||
            error.message.toLowerCase().includes('connection')) {
            return _("Connection Failed");
        }
        return _("API Request Failed");
    };

    const getErrorDescription = () => {
        if (error.statusCode === 401 || error.statusCode === 403) {
            return _("The API key may be invalid or expired. Please check your settings.");
        }
        if (error.statusCode === 429) {
            return _("Too many requests. Please wait a moment and try again.");
        }
        if (error.statusCode && error.statusCode >= 500) {
            return _("The AI provider is experiencing issues. Please try again later.");
        }
        if (error.message.toLowerCase().includes('network') ||
            error.message.toLowerCase().includes('timeout') ||
            error.message.toLowerCase().includes('connection')) {
            return _("Unable to connect to the AI provider. Please check your network connection.");
        }
        return _("An unexpected error occurred while communicating with the AI provider.");
    };

    const getRetryMessage = () => {
        return _(`Connection failed after ${error.attemptsMade} attempts (max ${error.maxRetries} retries with exponential backoff).`);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            aria-labelledby="error-modal-title"
            variant="medium"
            className="error-modal"
        >
            <ModalHeader
                title={
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>
                            <ExclamationCircleIcon className="error-modal-icon" />
                        </FlexItem>
                        <FlexItem>
                            <span className="error-modal-title">{getErrorTitle()}</span>
                        </FlexItem>
                    </Flex>
                }
                labelId="error-modal-title"
            />
            <ModalBody className="error-modal-body">
                <Alert
                    variant="danger"
                    isInline
                    isPlain
                    title={getErrorDescription()}
                    className="error-modal-alert"
                />

                <div className="error-modal-retry-info">
                    <p>{getRetryMessage()}</p>
                </div>

                <ExpandableSection
                    toggleText={isDetailsExpanded ? _("Hide technical details") : _("Show technical details")}
                    onToggle={(_event, expanded) => setIsDetailsExpanded(expanded)}
                    isExpanded={isDetailsExpanded}
                    className="error-modal-details"
                >
                    <div className="error-details-content">
                        {error.provider && (
                            <div className="error-detail-row">
                                <span className="error-detail-label">{_("Provider:")}</span>
                                <code className="error-detail-value">{error.provider}</code>
                            </div>
                        )}
                        {error.endpoint && (
                            <div className="error-detail-row">
                                <span className="error-detail-label">{_("Endpoint:")}</span>
                                <code className="error-detail-value">{error.endpoint}</code>
                            </div>
                        )}
                        {error.statusCode && (
                            <div className="error-detail-row">
                                <span className="error-detail-label">{_("Status Code:")}</span>
                                <code className="error-detail-value">{error.statusCode}</code>
                            </div>
                        )}
                        <div className="error-detail-row">
                            <span className="error-detail-label">{_("Attempts:")}</span>
                            <code className="error-detail-value">{error.attemptsMade} / {error.maxRetries + 1}</code>
                        </div>
                        {error.lastAttemptTime && (
                            <div className="error-detail-row">
                                <span className="error-detail-label">{_("Last Attempt:")}</span>
                                <code className="error-detail-value">{error.lastAttemptTime.toLocaleTimeString()}</code>
                            </div>
                        )}
                        <div className="error-detail-row error-message-row">
                            <span className="error-detail-label">{_("Error Message:")}</span>
                            <code className="error-detail-value error-message">{error.message}</code>
                        </div>
                    </div>
                </ExpandableSection>
            </ModalBody>

            <ModalFooter>
                {onRetry && (
                    <Button
                        variant="primary"
                        onClick={onRetry}
                        icon={<RedoIcon />}
                    >
                        {_("Retry")}
                    </Button>
                )}
                <Button variant="link" onClick={onClose}>
                    {_("Dismiss")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
