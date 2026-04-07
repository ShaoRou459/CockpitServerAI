/*
 * SettingsModal - Configuration UI for AI provider and behavior settings
 * 
 * Multi-page design with sidebar navigation, Cockpit-native styling
 */

import React, { useState, useEffect } from 'react';
import {
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Form,
    FormGroup,
    FormSelect,
    FormSelectOption,
    TextInput,
    Switch,
    Button,
    HelperText,
    HelperTextItem,
    NumberInput,
    Alert,
    Split,
    SplitItem,
} from "@patternfly/react-core";
import {
    EyeIcon,
    EyeSlashIcon,
    LockIcon,
    ShieldAltIcon,
    BoltIcon,
    RocketIcon,
    SkullIcon,
    CheckCircleIcon,
    ServerIcon,
    CogIcon,
    SecurityIcon,
    CodeIcon,
    InfoCircleIcon,
    ExternalLinkAltIcon,
    TimesIcon,
} from "@patternfly/react-icons";
import cockpit from 'cockpit';

import { Settings, PROVIDERS, SAFETY_MODES, SafetyMode } from '../lib/settings';

const _ = cockpit.gettext;

// Safety mode icon mapping
const SAFETY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    lock: LockIcon,
    shield: ShieldAltIcon,
    bolt: BoltIcon,
    rocket: RocketIcon,
    skull: SkullIcon,
};

// Settings pages configuration
type SettingsPage = 'provider' | 'behavior' | 'security' | 'developer' | 'about';

interface PageConfig {
    id: SettingsPage;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}

const PAGES: PageConfig[] = [
    { id: 'provider', label: 'Provider', icon: ServerIcon },
    { id: 'behavior', label: 'Behavior', icon: CogIcon },
    { id: 'security', label: 'Security', icon: SecurityIcon },
    { id: 'developer', label: 'Developer', icon: CodeIcon },
    { id: 'about', label: 'About', icon: InfoCircleIcon },
];

interface SettingsModalProps {
    isOpen: boolean;
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    onClose: () => void;
    onRestartOnboarding?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    settings,
    onSave,
    onClose,
    onRestartOnboarding
}) => {
    const [formData, setFormData] = useState<Settings>(settings);
    const [activePage, setActivePage] = useState<SettingsPage>('provider');
    const [showApiKey, setShowApiKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [useCustomModel, setUseCustomModel] = useState(false);
    const [isClosing, setIsClosing] = useState(false);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setFormData(settings);
            setShowApiKey(false);
            setActivePage('provider');
            setIsClosing(false);
            // Detect if current model is custom
            const providerModels = PROVIDERS[settings.provider]?.models || [];
            setUseCustomModel(!providerModels.includes(settings.model));
        }
    }, [isOpen, settings]);

    const handleAnimatedClose = () => {
        if (isClosing) return;
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 200);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(formData);
        } finally {
            setIsSaving(false);
        }
    };

    const updateField = <K extends keyof Settings>(field: K, value: Settings[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleProviderChange = (newProvider: string) => {
        const provider = newProvider as keyof typeof PROVIDERS;
        updateField('provider', provider);

        // Reset model to first available
        const models = PROVIDERS[provider]?.models || [];
        if (models.length > 0 && !useCustomModel) {
            updateField('model', models[0]);
        }
    };

    const providerConfig = PROVIDERS[formData.provider];
    const availableModels = providerConfig?.models || [];

    // ============ Page Components ============

    const ProviderPage = () => (
        <Form className="settings-page-form">
            <FormGroup label={_("Provider")} isRequired fieldId="settings-provider">
                <FormSelect
                    id="settings-provider"
                    value={formData.provider}
                    onChange={(_e, value) => handleProviderChange(value)}
                >
                    {Object.entries(PROVIDERS).map(([key, config]) => (
                        <FormSelectOption key={key} value={key} label={config.name} />
                    ))}
                </FormSelect>
                <HelperText>
                    <HelperTextItem>{providerConfig?.description}</HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup label={_("API Key")} isRequired fieldId="settings-api-key">
                <Split hasGutter>
                    <SplitItem isFilled>
                        <TextInput
                            id="settings-api-key"
                            type={showApiKey ? 'text' : 'password'}
                            value={formData.apiKey}
                            onChange={(_e, value) => updateField('apiKey', value)}
                            placeholder={formData.provider === 'gemini' ? 'AIza...' : 'sk-...'}
                        />
                    </SplitItem>
                    <SplitItem>
                        <Button
                            variant="control"
                            onClick={() => setShowApiKey(!showApiKey)}
                            aria-label={showApiKey ? _("Hide API key") : _("Show API key")}
                        >
                            {showApiKey ? <EyeSlashIcon /> : <EyeIcon />}
                        </Button>
                    </SplitItem>
                </Split>
            </FormGroup>

            <FormGroup label={_("Model")} isRequired fieldId="settings-model">
                {!useCustomModel && availableModels.length > 0 ? (
                    <FormSelect
                        id="settings-model"
                        value={availableModels.includes(formData.model) ? formData.model : availableModels[0]}
                        onChange={(_e, value) => updateField('model', value)}
                    >
                        {availableModels.map(model => (
                            <FormSelectOption key={model} value={model} label={model} />
                        ))}
                    </FormSelect>
                ) : (
                    <TextInput
                        id="settings-model"
                        value={formData.model}
                        onChange={(_e, value) => updateField('model', value)}
                        placeholder="model-name"
                    />
                )}
                <HelperText>
                    <HelperTextItem>
                        <Button
                            variant="link"
                            isInline
                            onClick={() => setUseCustomModel(!useCustomModel)}
                        >
                            {useCustomModel ? _("Use preset models") : _("Use custom model")}
                        </Button>
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup label={_("Base URL")} fieldId="settings-base-url">
                <TextInput
                    id="settings-base-url"
                    value={formData.baseUrl}
                    onChange={(_e, value) => updateField('baseUrl', value)}
                    placeholder={providerConfig?.defaultBaseUrl}
                />
                <HelperText>
                    <HelperTextItem>
                        {_("Override for proxies or local deployments (e.g., Ollama)")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>
        </Form>
    );

    const BehaviorPage = () => (
        <Form className="settings-page-form settings-page-form--behavior">
            <FormGroup label={_("Automation Level")} fieldId="settings-safety-mode">
                <div className="safety-mode-grid">
                    {(Object.entries(SAFETY_MODES) as [SafetyMode, typeof SAFETY_MODES[SafetyMode]][]).map(([key, config]) => {
                        const IconComponent = SAFETY_ICONS[config.icon];
                        const isSelected = formData.safetyMode === key;
                        const isDanger = key === 'full_yolo';

                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => updateField('safetyMode', key)}
                                className={[
                                    'safety-mode-option',
                                    isSelected && 'safety-mode-option--selected',
                                    isDanger && 'safety-mode-option--danger',
                                ].filter(Boolean).join(' ')}
                            >
                                <span className="safety-mode-option__icon">
                                    {isSelected ? <CheckCircleIcon /> : <IconComponent />}
                                </span>
                                <span className="safety-mode-option__label">{config.name}</span>
                            </button>
                        );
                    })}
                </div>
                <HelperText>
                    <HelperTextItem>
                        {SAFETY_MODES[formData.safetyMode].description}
                    </HelperTextItem>
                </HelperText>

                {formData.safetyMode === 'full_yolo' && (
                    <Alert
                        variant="danger"
                        isInline
                        title={_("Dangerous mode")}
                        className="pf-v6-u-mt-md"
                    >
                        {_("All commands will auto-execute including destructive ones. Use only if you fully trust the AI.")}
                    </Alert>
                )}
            </FormGroup>

            <FormGroup label={_("Temperature")} fieldId="settings-temperature">
                <Split hasGutter>
                    <SplitItem isFilled>
                        <input
                            type="range"
                            id="settings-temperature-slider"
                            min={0}
                            max={2}
                            step={0.1}
                            value={formData.temperature}
                            onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
                            className="settings-slider"
                        />
                    </SplitItem>
                    <SplitItem>
                        <span className="settings-slider-value">{formData.temperature.toFixed(1)}</span>
                    </SplitItem>
                </Split>
                <HelperText>
                    <HelperTextItem>
                        {_("Lower = focused and deterministic, higher = creative and varied")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup label={_("Max Tokens")} fieldId="settings-max-tokens">
                <NumberInput
                    id="settings-max-tokens"
                    value={formData.maxTokens}
                    onChange={(e) => {
                        const val = parseInt((e.target as HTMLInputElement).value);
                        if (!isNaN(val)) updateField('maxTokens', val);
                    }}
                    onMinus={() => updateField('maxTokens', Math.max(256, formData.maxTokens - 256))}
                    onPlus={() => updateField('maxTokens', Math.min(32000, formData.maxTokens + 256))}
                    min={256}
                    max={32000}
                />
                <HelperText>
                    <HelperTextItem>{_("Maximum length of AI responses")}</HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup label={_("Output Truncate Length")} fieldId="settings-output-truncate">
                <Split hasGutter>
                    <SplitItem isFilled>
                        <input
                            type="range"
                            id="settings-output-truncate-slider"
                            min={1000}
                            max={50000}
                            step={1000}
                            value={formData.outputTruncateLength}
                            onChange={(e) => updateField('outputTruncateLength', parseInt(e.target.value))}
                            className="settings-slider"
                        />
                    </SplitItem>
                    <SplitItem>
                        <span className="settings-slider-value">{(formData.outputTruncateLength / 1000).toFixed(0)}k</span>
                    </SplitItem>
                </Split>
                <HelperText>
                    <HelperTextItem>
                        {_("Max characters of command output sent to AI (higher = more context, more tokens)")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup label={_("Max Execution Steps")} fieldId="settings-max-steps">
                <Split hasGutter>
                    <SplitItem isFilled>
                        <input
                            type="range"
                            id="settings-max-steps-slider"
                            min={1}
                            max={50}
                            step={1}
                            value={formData.maxExecutionSteps}
                            onChange={(e) => updateField('maxExecutionSteps', parseInt(e.target.value))}
                            className="settings-slider"
                        />
                    </SplitItem>
                    <SplitItem>
                        <span className="settings-slider-value">{formData.maxExecutionSteps}</span>
                    </SplitItem>
                </Split>
                <HelperText>
                    <HelperTextItem>
                        {_("Maximum action-loop iterations per request before the agent stops (prevents runaway tasks)")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup fieldId="settings-stream-responses">
                <Switch
                    id="settings-stream-responses"
                    label={_("Stream AI responses")}
                    isChecked={formData.streamResponses}
                    onChange={(_e, checked) => updateField('streamResponses', checked)}
                />
                <HelperText>
                    <HelperTextItem>
                        {_("Show the assistant's response as it is generated (recommended)")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup fieldId="settings-restore-session-on-startup">
                <Switch
                    id="settings-restore-session-on-startup"
                    label={_("Restore last session on startup")}
                    isChecked={formData.restoreLastSessionOnStartup}
                    onChange={(_e, checked) => updateField('restoreLastSessionOnStartup', checked)}
                />
                <HelperText>
                    <HelperTextItem>
                        {_("When disabled, opening the app always starts a new chat session")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>
        </Form>
    );

    const SecurityPage = () => (
        <Form className="settings-page-form">
            <FormGroup fieldId="settings-secret-redaction">
                <Switch
                    id="settings-secret-redaction"
                    label={_("Redact secrets")}
                    isChecked={formData.secretRedaction}
                    onChange={(_e, checked) => updateField('secretRedaction', checked)}
                />
                <HelperText>
                    <HelperTextItem>
                        {_("Automatically mask passwords, API keys, and tokens before sending to AI")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            {!formData.secretRedaction && (
                <Alert
                    variant="warning"
                    isInline
                    title={_("Secrets exposed")}
                >
                    {_("Sensitive data will be visible to the AI provider.")}
                </Alert>
            )}

            <FormGroup label={_("Blocked Patterns")} fieldId="settings-blocklist">
                <div className="blocklist-display">
                    {formData.commandBlocklist.map((pattern, i) => (
                        <code key={i} className="blocklist-pattern">{pattern}</code>
                    ))}
                </div>
                <HelperText>
                    <HelperTextItem>
                        {_("These commands are always blocked regardless of safety mode")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            <FormGroup fieldId="settings-log-commands">
                <Switch
                    id="settings-log-commands"
                    label={_("Log executed commands")}
                    isChecked={formData.logCommands}
                    onChange={(_e, checked) => updateField('logCommands', checked)}
                />
                <HelperText>
                    <HelperTextItem>
                        {_("Keep a record of all commands executed by the AI")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>
        </Form>
    );

    const DeveloperPage = () => (
        <Form className="settings-page-form">
            <FormGroup fieldId="settings-debug-mode">
                <Switch
                    id="settings-debug-mode"
                    label={_("Debug mode")}
                    isChecked={formData.debugMode}
                    onChange={(_e, checked) => updateField('debugMode', checked)}
                />
                <HelperText>
                    <HelperTextItem>
                        {_("Enable verbose console logging and debug panel")}
                    </HelperTextItem>
                </HelperText>
            </FormGroup>

            {onRestartOnboarding && (
                <FormGroup fieldId="settings-restart-onboarding">
                    <Button
                        variant="secondary"
                        onClick={() => {
                            onClose();
                            onRestartOnboarding();
                        }}
                    >
                        {_("Restart Onboarding")}
                    </Button>
                    <HelperText>
                        <HelperTextItem>
                            {_("Re-run the setup wizard (for testing purposes)")}
                        </HelperTextItem>
                    </HelperText>
                </FormGroup>
            )}
        </Form>
    );

    const AboutPage = () => (
        <div className="about-page">
            <div className="about-header">
                <RocketIcon className="about-logo" />
                <div className="about-title-block">
                    <h2 className="about-product-name">{_("Cockpit AI Agent")}</h2>
                    <span className="about-version">v1.0.0</span>
                </div>
            </div>

            <p className="about-description">
                {_("An AI-powered terminal assistant for server administration. Chat with an AI that can execute commands, manage services, and help troubleshoot your Linux servers directly through Cockpit.")}
            </p>

            <div className="about-links">
                <a
                    href="https://github.com/peter/cockpit-ai-agent"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-link"
                >
                    <ExternalLinkAltIcon /> {_("GitHub Repository")}
                </a>
            </div>

            <div className="about-meta">
                <div className="about-meta-item">
                    <strong>{_("License")}</strong>
                    <span>LGPL-2.1</span>
                </div>
            </div>

            <div className="about-disclaimer">
                <h4>{_("Disclaimer")}</h4>
                <p>
                    {_("This software is provided \"as is\", without warranty of any kind, express or implied. The authors and contributors are not liable for any damages or issues arising from the use of this software. Use at your own risk. Always review commands before execution, especially in production environments.")}
                </p>
            </div>
        </div>
    );

    // Render the active page content
    const renderPageContent = () => {
        switch (activePage) {
            case 'provider':
                return ProviderPage();
            case 'behavior':
                return BehaviorPage();
            case 'security':
                return SecurityPage();
            case 'developer':
                return DeveloperPage();
            case 'about':
                return AboutPage();
            default:
                return null;
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleAnimatedClose}
            aria-labelledby="settings-modal-title"
            variant="large"
            className={`settings-modal ${isClosing ? 'settings-modal--closing' : ''}`}
        >
            <ModalHeader labelId="settings-modal-title">
                <div className="settings-modal-header">
                    <span className="settings-modal-title">{_("Settings")}</span>
                    <button
                        type="button"
                        className="settings-modal-close"
                        onClick={handleAnimatedClose}
                        aria-label={_("Close")}
                    >
                        <TimesIcon />
                    </button>
                </div>
            </ModalHeader>
            <ModalBody className="settings-modal-body">
                <div className="settings-layout">
                    {/* Sidebar Navigation */}
                    <nav className="settings-nav" aria-label={_("Settings navigation")}>
                        {PAGES.map(page => {
                            const Icon = page.icon;
                            const isActive = activePage === page.id;
                            return (
                                <button
                                    key={page.id}
                                    type="button"
                                    className={`settings-nav-item ${isActive ? 'settings-nav-item--active' : ''}`}
                                    onClick={() => setActivePage(page.id)}
                                    aria-current={isActive ? 'page' : undefined}
                                >
                                    <Icon className="settings-nav-item__icon" />
                                    <span className="settings-nav-item__label">{_(page.label)}</span>
                                </button>
                            );
                        })}
                    </nav>

                    {/* Page Content */}
                    <div className="settings-content" key={activePage}>
                        <h3 className="settings-page-title">
                            {_(PAGES.find(p => p.id === activePage)?.label || '')}
                        </h3>
                        {renderPageContent()}
                    </div>
                </div>
            </ModalBody>

            <ModalFooter>
                <Button
                    variant="primary"
                    onClick={handleSave}
                    isLoading={isSaving}
                    isDisabled={!formData.apiKey.trim()}
                >
                    {_("Save")}
                </Button>
                <Button variant="link" onClick={handleAnimatedClose}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
