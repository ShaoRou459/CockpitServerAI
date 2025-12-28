/*
 * SettingsModal - Configuration UI for AI provider and behavior settings
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
    ActionGroup,
    Tabs,
    Tab,
    TabTitleText,
    HelperText,
    HelperTextItem,
    NumberInput,
    Alert,
    Divider,
    Card,
    CardBody,
    Label,
} from "@patternfly/react-core";
import { EyeIcon, EyeSlashIcon, LockIcon, ShieldAltIcon, BoltIcon, RocketIcon, SkullIcon } from "@patternfly/react-icons";
import cockpit from 'cockpit';

import { Settings, PROVIDERS, SAFETY_MODES, SafetyMode } from '../lib/settings';

const _ = cockpit.gettext;

// Map icon names to components
const SAFETY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    lock: LockIcon,
    shield: ShieldAltIcon,
    bolt: BoltIcon,
    rocket: RocketIcon,
    skull: SkullIcon,
};

interface SettingsModalProps {
    isOpen: boolean;
    settings: Settings;
    onSave: (settings: Settings) => Promise<void>;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    settings,
    onSave,
    onClose
}) => {
    const [formData, setFormData] = useState<Settings>(settings);
    const [activeTab, setActiveTab] = useState(0);
    const [showApiKey, setShowApiKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [customModel, setCustomModel] = useState('');

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setFormData(settings);
            setShowApiKey(false);
            // Check if model is custom
            const providerModels = PROVIDERS[settings.provider]?.models || [];
            if (!providerModels.includes(settings.model)) {
                setCustomModel(settings.model);
            } else {
                setCustomModel('');
            }
        }
    }, [isOpen, settings]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Use custom model if specified
            const finalSettings = {
                ...formData,
                model: customModel || formData.model
            };
            await onSave(finalSettings);
        } finally {
            setIsSaving(false);
        }
    };

    const updateField = <K extends keyof Settings>(field: K, value: Settings[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const providerConfig = PROVIDERS[formData.provider];
    const availableModels = providerConfig?.models || [];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            aria-labelledby="settings-modal-title"
            variant="medium"
        >
            <ModalHeader title={_("AI Agent Settings")} labelId="settings-modal-title" />
            <ModalBody>
                <Tabs activeKey={activeTab} onSelect={(_e, key) => setActiveTab(key as number)}>
                    {/* Provider Tab */}
                    <Tab eventKey={0} title={<TabTitleText>{_("Provider")}</TabTitleText>}>
                        <Form style={{ marginTop: '16px' }}>
                            <FormGroup label={_("AI Provider")} isRequired fieldId="provider">
                                <FormSelect
                                    id="provider"
                                    value={formData.provider}
                                    onChange={(_e, value) => {
                                        updateField('provider', value as Settings['provider']);
                                        // Reset model to first available for new provider
                                        const newProviderModels = PROVIDERS[value as keyof typeof PROVIDERS]?.models || [];
                                        if (newProviderModels.length > 0) {
                                            updateField('model', newProviderModels[0]);
                                        }
                                        setCustomModel('');
                                    }}
                                >
                                    {Object.entries(PROVIDERS).map(([key, config]) => (
                                        <FormSelectOption
                                            key={key}
                                            value={key}
                                            label={config.name}
                                        />
                                    ))}
                                </FormSelect>
                            </FormGroup>

                            <FormGroup label={_("API Key")} isRequired fieldId="api-key">
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <TextInput
                                        id="api-key"
                                        type={showApiKey ? 'text' : 'password'}
                                        value={formData.apiKey}
                                        onChange={(_e, value) => updateField('apiKey', value)}
                                        placeholder={formData.provider === 'gemini' ? 'AIza...' : 'sk-...'}
                                        style={{ flex: 1 }}
                                    />
                                    <Button
                                        variant="control"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                                    >
                                        {showApiKey ? <EyeSlashIcon /> : <EyeIcon />}
                                    </Button>
                                </div>
                                <HelperText>
                                    <HelperTextItem>
                                        {formData.provider === 'gemini'
                                            ? _("Get your API key from Google AI Studio")
                                            : formData.provider === 'openai'
                                                ? _("Get your API key from platform.openai.com")
                                                : _("Enter your API key for the custom provider")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormGroup>

                            <FormGroup label={_("Model")} isRequired fieldId="model">
                                {availableModels.length > 0 ? (
                                    <FormSelect
                                        id="model"
                                        value={availableModels.includes(formData.model) ? formData.model : 'custom'}
                                        onChange={(_e, value) => {
                                            if (value === 'custom') {
                                                setCustomModel(formData.model);
                                            } else {
                                                updateField('model', value);
                                                setCustomModel('');
                                            }
                                        }}
                                    >
                                        {availableModels.map(model => (
                                            <FormSelectOption
                                                key={model}
                                                value={model}
                                                label={model}
                                            />
                                        ))}
                                        <FormSelectOption value="custom" label={_("Custom model...")} />
                                    </FormSelect>
                                ) : (
                                    <TextInput
                                        id="model"
                                        value={formData.model}
                                        onChange={(_e, value) => updateField('model', value)}
                                        placeholder="gpt-4o"
                                    />
                                )}
                            </FormGroup>

                            {(customModel || availableModels.length === 0) && availableModels.length > 0 && (
                                <FormGroup label={_("Custom Model Name")} fieldId="custom-model">
                                    <TextInput
                                        id="custom-model"
                                        value={customModel}
                                        onChange={(_e, value) => setCustomModel(value)}
                                        placeholder="model-name"
                                    />
                                </FormGroup>
                            )}

                            <FormGroup label={_("Base URL (optional)")} fieldId="base-url">
                                <TextInput
                                    id="base-url"
                                    value={formData.baseUrl}
                                    onChange={(_e, value) => updateField('baseUrl', value)}
                                    placeholder={providerConfig?.defaultBaseUrl || 'https://api.example.com/v1'}
                                />
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Leave empty to use the default endpoint. Override for proxies or custom deployments.")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormGroup>
                        </Form>
                    </Tab>

                    {/* Behavior Tab */}
                    <Tab eventKey={1} title={<TabTitleText>{_("Behavior")}</TabTitleText>}>
                        <Form style={{ marginTop: '16px' }}>
                            <FormGroup label={_("Safety Mode")} fieldId="safety-mode">
                                <HelperText style={{ marginBottom: '12px' }}>
                                    <HelperTextItem>
                                        {_("Choose how much automation you want. Higher levels = faster but more risk.")}
                                    </HelperTextItem>
                                </HelperText>
                                <div className="safety-mode-selector">
                                    {(Object.entries(SAFETY_MODES) as [SafetyMode, typeof SAFETY_MODES[SafetyMode]][]).map(([key, config]) => {
                                        const IconComponent = SAFETY_ICONS[config.icon];
                                        const isSelected = formData.safetyMode === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => updateField('safetyMode', key)}
                                                className={`safety-option ${isSelected ? 'safety-option--selected' : ''} ${key === 'full_yolo' ? 'safety-option--danger' : ''}`}
                                                title={config.description}
                                            >
                                                <IconComponent className="safety-option-icon" />
                                                <span className="safety-option-name">{config.name}</span>
                                                <span className="safety-option-desc">{config.description}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <HelperText style={{ marginTop: '8px' }}>
                                    <HelperTextItem>
                                        {SAFETY_MODES[formData.safetyMode].description}
                                    </HelperTextItem>
                                </HelperText>
                                {formData.safetyMode === 'full_yolo' && (
                                    <Alert
                                        variant="danger"
                                        isInline
                                        title={_("Extreme danger!")}
                                        style={{ marginTop: '12px' }}
                                    >
                                        {_("Full YOLO mode will auto-execute ALL commands including destructive ones like 'rm -rf'. Only use this if you fully trust the AI and understand the risks.")}
                                    </Alert>
                                )}
                            </FormGroup>

                            <Divider />

                            <FormGroup label={_("Temperature")} fieldId="temperature">
                                <NumberInput
                                    id="temperature"
                                    value={formData.temperature}
                                    onChange={(e) => {
                                        const target = e.target as HTMLInputElement;
                                        updateField('temperature', parseFloat(target.value) || 0.7);
                                    }}
                                    onMinus={() => updateField('temperature', Math.max(0, formData.temperature - 0.1))}
                                    onPlus={() => updateField('temperature', Math.min(2, formData.temperature + 0.1))}
                                    min={0}
                                    max={2}
                                    minusBtnAriaLabel="Decrease temperature"
                                    plusBtnAriaLabel="Increase temperature"
                                />
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Lower = more focused, higher = more creative (0.0 - 2.0)")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormGroup>

                            <FormGroup label={_("Max Tokens")} fieldId="max-tokens">
                                <NumberInput
                                    id="max-tokens"
                                    value={formData.maxTokens}
                                    onChange={(e) => {
                                        const target = e.target as HTMLInputElement;
                                        updateField('maxTokens', parseInt(target.value) || 4096);
                                    }}
                                    onMinus={() => updateField('maxTokens', Math.max(256, formData.maxTokens - 256))}
                                    onPlus={() => updateField('maxTokens', Math.min(32000, formData.maxTokens + 256))}
                                    min={256}
                                    max={32000}
                                    minusBtnAriaLabel="Decrease max tokens"
                                    plusBtnAriaLabel="Increase max tokens"
                                />
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Maximum response length from the AI")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormGroup>
                        </Form>
                    </Tab>

                    {/* Safety Tab */}
                    <Tab eventKey={2} title={<TabTitleText>{_("Safety")}</TabTitleText>}>
                        <Form style={{ marginTop: '16px' }}>
                            <Alert
                                variant="info"
                                isInline
                                title={_("Command Safety")}
                            >
                                {_("Dangerous commands matching patterns in the blocklist will never be executed, regardless of YOLO mode.")}
                            </Alert>

                            <FormGroup label={_("Blocked Command Patterns")} fieldId="blocklist" style={{ marginTop: '16px' }}>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Commands containing these patterns will be blocked:")}
                                    </HelperTextItem>
                                </HelperText>
                                <div className="blocklist-patterns">
                                    {formData.commandBlocklist.map((pattern, i) => (
                                        <div key={i}>• {pattern}</div>
                                    ))}
                                </div>
                            </FormGroup>

                            <Divider style={{ marginTop: '16px', marginBottom: '16px' }} />

                            <FormGroup fieldId="secret-redaction">
                                <Switch
                                    id="secret-redaction"
                                    label={_("Secret Redaction")}
                                    isChecked={formData.secretRedaction}
                                    onChange={(_e, checked) => updateField('secretRedaction', checked)}
                                />
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Automatically detect and hide sensitive data (passwords, API keys, tokens) from the AI. The AI will see placeholders like __SECRET_1__ but can still use them in commands.")}
                                    </HelperTextItem>
                                </HelperText>
                                {!formData.secretRedaction && (
                                    <Alert
                                        variant="warning"
                                        isInline
                                        title={_("Security risk")}
                                        style={{ marginTop: '8px' }}
                                    >
                                        {_("Disabling secret redaction means sensitive data like passwords and API keys will be visible to the AI model. Only disable this if you trust the model provider with this data.")}
                                    </Alert>
                                )}
                            </FormGroup>

                            <Divider style={{ marginTop: '16px', marginBottom: '16px' }} />

                            <FormGroup fieldId="log-commands">
                                <Switch
                                    id="log-commands"
                                    label={_("Log executed commands")}
                                    isChecked={formData.logCommands}
                                    onChange={(_e, checked) => updateField('logCommands', checked)}
                                />
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Keep a record of all commands executed by the AI agent")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormGroup>

                            <Divider />

                            <FormGroup fieldId="debug-mode">
                                <Switch
                                    id="debug-mode"
                                    label={_("Debug Mode")}
                                    isChecked={formData.debugMode}
                                    onChange={(_e, checked) => updateField('debugMode', checked)}
                                />
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Show verbose logging in the browser console for troubleshooting")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormGroup>
                        </Form>
                    </Tab>
                </Tabs>
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="primary"
                    onClick={handleSave}
                    isLoading={isSaving}
                    isDisabled={!formData.apiKey}
                >
                    {_("Save")}
                </Button>
                <Button variant="link" onClick={onClose}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal >
    );
};
