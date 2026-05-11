/*
 * OnboardingModal - Multi-step onboarding wizard for first-time setup
 *
 * Steps:
 * 1. Welcome - Introduction to the Agent
 * 2. Provider - Configure AI provider (OpenAI, Gemini, etc.)
 * 3. Safety - Choose automation/safety level
 * 4. Disclaimer - Liability agreement
 */

import React, { useState, useEffect } from "react";
import {
  Modal,
  ModalBody,
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
  Checkbox,
  Alert,
  Split,
  SplitItem,
  HelperText,
  HelperTextItem,
} from "@patternfly/react-core";
import {
  RocketIcon,
  ServerIcon,
  ShieldAltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  EyeIcon,
  EyeSlashIcon,
  LockIcon,
  BoltIcon,
  SkullIcon,
  GlobeAmericasIcon,
  TerminalIcon,
} from "@patternfly/react-icons";
import { Settings, PROVIDERS, SAFETY_MODES, SafetyMode } from "../lib/settings";
import { useI18n } from "../lib/i18n";

// @ts-ignore
import logoTextUrl from "../logo-text.png";

// Step configuration
type OnboardingStep = "language" | "welcome" | "provider" | "safety" | "disclaimer" | "congratulations";

interface StepConfig {
  id: OnboardingStep;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepConfig[] = [
  {
    id: "language",
    title: "Language",
    subtitle: "Select Language",
    icon: GlobeAmericasIcon,
  },
  {
    id: "welcome",
    title: "Welcome",
    subtitle: "Introduction",
    icon: RocketIcon,
  },
  {
    id: "provider",
    title: "AI Provider",
    subtitle: "Configuration",
    icon: ServerIcon,
  },
  {
    id: "safety",
    title: "Safety Mode",
    subtitle: "Automation Level",
    icon: ShieldAltIcon,
  },
  {
    id: "disclaimer",
    title: "Agreement",
    subtitle: "Terms of Use",
    icon: ExclamationTriangleIcon,
  },
  {
    id: "congratulations",
    title: "Setup Complete",
    subtitle: "Congratulations",
    icon: CheckCircleIcon,
  },
];

// Safety mode icon mapping
const SAFETY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  lock: LockIcon,
  shield: ShieldAltIcon,
  bolt: BoltIcon,
  rocket: RocketIcon,
  skull: SkullIcon,
};

interface OnboardingModalProps {
  isOpen: boolean;
  initialSettings: Settings;
  onComplete: (settings: Settings) => Promise<void>;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  initialSettings,
  onComplete,
}) => {
  const { t, setLanguage, languages } = useI18n();
  const _ = t;
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("language");
  const [formData, setFormData] = useState<Settings>(initialSettings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep("language");
      setFormData(initialSettings);
      setShowApiKey(false);
      setDisclaimerAccepted(false);
      setValidationError(null);
      // Detect if current model is custom
      const providerModels = PROVIDERS[initialSettings.provider]?.models || [];
      setUseCustomModel(!providerModels.includes(initialSettings.model));
    }
  }, [isOpen, initialSettings]);

  const updateField = <K extends keyof Settings>(
    field: K,
    value: Settings[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === "language") {
      setLanguage(value as Settings[K] & ("en" | "zh-CN"));
    }
    setValidationError(null);
  };

  const handleProviderChange = (newProvider: string) => {
    const provider = newProvider as keyof typeof PROVIDERS;
    updateField("provider", provider);

    // Reset model to first available
    const models = PROVIDERS[provider]?.models || [];
    if (models.length > 0 && !useCustomModel) {
      updateField("model", models[0]);
    }
  };

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const safeStepIndex = Math.max(currentStepIndex, 0);
  const totalSteps = STEPS.length;
  const stepsCompleted = safeStepIndex + 1;
  const stepsLeft = Math.max(totalSteps - stepsCompleted, 0);
  const progressPercent = Math.round((stepsCompleted / totalSteps) * 100);
  const stepsLeftText =
    stepsLeft === 1
      ? _("1 step left")
      : _("{count} steps left", { count: stepsLeft });

  const providerConfig = PROVIDERS[formData.provider];
  const availableModels = providerConfig?.models || [];

  const canProceed = (): boolean => {
    switch (currentStep) {
      case "language":
      case "welcome":
        return true;
      case "provider":
        // Require API key for non-custom providers
        return formData.apiKey.trim().length > 0;
      case "safety":
        return true;
      case "disclaimer":
        return disclaimerAccepted;
      case "congratulations":
        return true;
      default:
        return true;
    }
  };

  const STEP_ORDER: OnboardingStep[] = STEPS.map((s) => s.id);

  const handleNext = () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);

    if (currentStep === "provider" && !formData.apiKey.trim()) {
      setValidationError(_("Please enter an API key to continue"));
      return;
    }

    if (currentIndex < STEP_ORDER.length - 1) {
      setCurrentStep(STEP_ORDER[currentIndex + 1]);
      setValidationError(null);
    }
  };

  const handleBack = () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(STEP_ORDER[currentIndex - 1]);
      setValidationError(null);
    }
  };

  const handleComplete = async () => {
    if (!disclaimerAccepted) {
      setValidationError(_("Please accept the terms to continue"));
      return;
    }

    setIsSubmitting(true);
    try {
      // Mark onboarding as complete
      const finalSettings: Settings = {
        ...formData,
        onboardingComplete: true,
      };
      await onComplete(finalSettings);
    } catch (error) {
      setValidationError(_("Failed to save settings. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============ Step Content Components ============

  const LanguageStep = () => (
    <div className="onboarding-step onboarding-language">
      <div className="onboarding-step__header">
        <GlobeAmericasIcon className="onboarding-step__icon" />
        <div>
          <h2 className="onboarding-step__title">{_("Language Selection")}</h2>
          <p className="onboarding-step__description">
            {_("Please select your preferred language layout.")}
          </p>
        </div>
      </div>
      <div className="onboarding-language__buttons pf-v6-u-mt-lg">
        {languages.map((option) => {
          const isSelected = formData.language === option.value;
          return (
            <Button
              key={option.value}
              variant="plain"
              aria-pressed={isSelected}
              className={`onboarding-language__button ${isSelected ? "is-selected" : ""}`}
              onClick={() =>
                updateField("language", option.value as Settings["language"])
              }
            >
              <div className="onboarding-language__button-content">
                <span className="onboarding-language__button-icon">
                  {option.value === "en" ? "Aa" : "你好"}
                </span>
                <span className="onboarding-language__button-label">
                  {option.label}
                </span>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );

  const WelcomeStep = () => (
    <div className="onboarding-step onboarding-welcome">
      <div className="onboarding-welcome__hero">
        <img src={logoTextUrl} alt="Cockpit Agent" className="onboarding-welcome__logo-img" />
        <p className="onboarding-welcome__subtitle">
          {_("Your AI-powered terminal assistant for server administration")}
        </p>
      </div>

      <div className="onboarding-welcome__features">
        <div className="onboarding-feature">
          <div className="onboarding-feature__icon">
            <RocketIcon />
          </div>
          <div className="onboarding-feature__content">
            <h4>{_("AI Powered Automation")}</h4>
            <p>{_("Automate complex tasks through intelligent prompt execution")}</p>
          </div>
        </div>
        <div className="onboarding-feature">
          <div className="onboarding-feature__icon">
            <TerminalIcon />
          </div>
          <div className="onboarding-feature__content">
            <h4>{_("Direct Terminal Access")}</h4>
            <p>{_("Let the agent seamlessly execute commands and view outputs in real time")}</p>
          </div>
        </div>
        <div className="onboarding-feature">
          <div className="onboarding-feature__icon">
            <ShieldAltIcon />
          </div>
          <div className="onboarding-feature__content">
            <h4>{_("Secure and Private")}</h4>
            <p>{_("Built-in protections and configurable safety levels")}</p>
          </div>
        </div>
      </div>

      <p className="onboarding-welcome__cta">
        {_("Let's get you set up in just a few steps.")}
      </p>
    </div>
  );

  const ProviderStep = () => (
    <div className="onboarding-step onboarding-provider">
      <div className="onboarding-step__header">
        <ServerIcon className="onboarding-step__icon" />
        <div>
          <h2 className="onboarding-step__title">
            {_("Configure AI Provider")}
          </h2>
          <p className="onboarding-step__description">
            {_("Choose your AI provider and enter your API credentials")}
          </p>
        </div>
      </div>

      <Form className="onboarding-form">
        <FormGroup
          label={_("Provider")}
          isRequired
          fieldId="onboarding-provider"
        >
          <FormSelect
            id="onboarding-provider"
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

        <FormGroup label={_("API Key")} isRequired fieldId="onboarding-api-key">
          <Split hasGutter>
            <SplitItem isFilled>
              <TextInput
                id="onboarding-api-key"
                type={showApiKey ? "text" : "password"}
                value={formData.apiKey}
                onChange={(_e, value) => updateField("apiKey", value)}
                placeholder={
                  formData.provider === "gemini" ? "AIza..." : "sk-..."
                }
                validated={
                  validationError && currentStep === "provider"
                    ? "error"
                    : "default"
                }
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
          <HelperText>
            <HelperTextItem>
              {formData.provider === "openai" ? (
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {_("Get your OpenAI API key →")}
                </a>
              ) : formData.provider === "gemini" ? (
                <a
                  href="https://makersuite.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {_("Get your Google AI Studio key →")}
                </a>
              ) : (
                _("Enter your API key from your provider")
              )}
            </HelperTextItem>
          </HelperText>
        </FormGroup>

        <div className="onboarding-provider__row">
          <FormGroup label={_("Model")} isRequired fieldId="onboarding-model" className="onboarding-provider__col">
            {!useCustomModel && availableModels.length > 0 ? (
              <FormSelect
                id="onboarding-model"
                value={
                  availableModels.includes(formData.model)
                    ? formData.model
                    : availableModels[0]
                }
                onChange={(_e, value) => updateField("model", value)}
              >
                {availableModels.map((model) => (
                  <FormSelectOption key={model} value={model} label={model} />
                ))}
              </FormSelect>
            ) : (
              <TextInput
                id="onboarding-model"
                value={formData.model}
                onChange={(_e, value) => updateField("model", value)}
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
                  {useCustomModel
                    ? _("Use preset models")
                    : _("Use custom model")}
                </Button>
              </HelperTextItem>
            </HelperText>
          </FormGroup>

          <FormGroup label={_("Base URL")} fieldId="onboarding-base-url" className="onboarding-provider__col">
            <TextInput
              id="onboarding-base-url"
              value={formData.baseUrl}
              onChange={(_e, value) => updateField("baseUrl", value)}
              placeholder={providerConfig?.defaultBaseUrl}
            />
            <HelperText>
              <HelperTextItem>
                {_(
                  "Optional: Local proxy override",
                )}
              </HelperTextItem>
            </HelperText>
          </FormGroup>
        </div>
      </Form>

      {validationError && (
        <Alert
          variant="danger"
          isInline
          title={validationError}
          className="pf-v6-u-mt-md"
        />
      )}
    </div>
  );

  const SafetyStep = () => (
    <div className="onboarding-step onboarding-safety">
      <div className="onboarding-step__header">
        <ShieldAltIcon className="onboarding-step__icon" />
        <div>
          <h2 className="onboarding-step__title">
            {_("Choose Your Safety Level")}
          </h2>
          <p className="onboarding-step__description">
            {_(
              "Select how much automation you want. You can change this anytime in settings.",
            )}
          </p>
        </div>
      </div>

      <div className="onboarding-safety__grid">
        {(
          Object.entries(SAFETY_MODES) as [
            SafetyMode,
            (typeof SAFETY_MODES)[SafetyMode],
          ][]
        ).map(([key, config]) => {
          const IconComponent = SAFETY_ICONS[config.icon];
          const isSelected = formData.safetyMode === key;
          const isDanger = key === "full_yolo";

          return (
            <button
              key={key}
              type="button"
              onClick={() => updateField("safetyMode", key)}
              className={[
                "onboarding-safety__option",
                isSelected && "onboarding-safety__option--selected",
                isDanger && "onboarding-safety__option--danger",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="onboarding-safety__option-icon">
                {isSelected ? <CheckCircleIcon /> : <IconComponent />}
              </div>
              <div className="onboarding-safety__option-content">
                <span className="onboarding-safety__option-name">
                  {_(config.name)}
                </span>
                <span className="onboarding-safety__option-desc">
                  {_(config.description)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {formData.safetyMode === "full_yolo" && (
        <Alert
          variant="danger"
          isInline
          title={_("⚠️ Full YOLO Mode")}
          className="pf-v6-u-mt-lg"
        >
          {_(
            "All commands will auto-execute including destructive ones like 'rm -rf'. Only use this if you fully trust the AI and accept all risks.",
          )}
        </Alert>
      )}

      <div className="onboarding-safety__recommendation">
        <CheckCircleIcon className="onboarding-safety__recommendation-icon" />
        <span>
          {_("We recommend ")}
          <strong>{_("Cautious")}</strong>
          {_(
            " mode for most users. It auto-runs safe read-only commands while requiring approval for anything that modifies your system.",
          )}
        </span>
      </div>
    </div>
  );

  const DisclaimerStep = () => (
    <div className="onboarding-step onboarding-disclaimer">
      <div className="onboarding-step__header">
        <ExclamationTriangleIcon className="onboarding-step__icon onboarding-step__icon--warning" />
        <div>
          <h2 className="onboarding-step__title">
            {_("Important Disclaimer")}
          </h2>
          <p className="onboarding-step__description">
            {_("Please read and accept the following before using the Agent")}
          </p>
        </div>
      </div>

      <div className="onboarding-disclaimer__content">
        <div className="onboarding-disclaimer__section">
          <h4>{_("No Warranty")}</h4>
          <p>
            {_(
              'This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement.',
            )}
          </p>
        </div>

        <div className="onboarding-disclaimer__section">
          <h4>{_("Limitation of Liability")}</h4>
          <p>
            {_(
              "In no event shall the authors, contributors, or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.",
            )}
          </p>
        </div>

        <div className="onboarding-disclaimer__section">
          <h4>{_("User Responsibility")}</h4>
          <p>
            {_(
              "You are solely responsible for all commands executed on your system. AI-generated commands may be incorrect, incomplete, or harmful. Always review commands before execution, especially in production environments.",
            )}
          </p>
        </div>

        <div className="onboarding-disclaimer__section">
          <h4>{_("Data Handling")}</h4>
          <p>
            {_(
              "Your prompts and command outputs may be sent to third-party AI providers (OpenAI, Google, etc.) for processing. While we redact detected secrets, you should never input highly sensitive information. Review your provider's data handling policies.",
            )}
          </p>
        </div>
      </div>

      <div className="onboarding-disclaimer__accept">
        <Checkbox
          id="accept-disclaimer"
          label={_(
            "I have read and understand the above disclaimer. I accept full responsibility for my use of this software and any commands executed on my system.",
          )}
          isChecked={disclaimerAccepted}
          onChange={(_e, checked) => {
            setDisclaimerAccepted(checked);
            setValidationError(null);
          }}
        />
      </div>

      {validationError && (
        <Alert
          variant="danger"
          isInline
          title={validationError}
          className="pf-v6-u-mt-md"
        />
      )}
    </div>
  );

  const CongratulationsStep = () => (
    <div className="onboarding-step onboarding-congratulations">
      <div className="onboarding-congratulations__content">
        <CheckCircleIcon className="onboarding-congratulations__icon" />
        <h2 className="onboarding-congratulations__title">{_("Setup Complete")}</h2>
        <p className="onboarding-congratulations__description">
          {_("Your AI assistant is configured and ready to go.")}
        </p>
      </div>
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case "language":
        return <LanguageStep />;
      case "welcome":
        return <WelcomeStep />;
      case "provider":
        return <ProviderStep />;
      case "safety":
        return <SafetyStep />;
      case "disclaimer":
        return <DisclaimerStep />;
      case "congratulations":
        return <CongratulationsStep />;
      default:
        return null;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      aria-labelledby="onboarding-modal-title"
      variant="large"
      className="onboarding-modal"
    >
      <div className="onboarding-modal__container">
        {/* Simple Header */}
        <div className="onboarding-modal__header">
          <span className="onboarding-modal__step-indicator">
            {_("Step")} {currentStepIndex + 1} {_("of")} {STEPS.length}
          </span>
        </div>

        {/* Step Content */}
        <ModalBody className="onboarding-modal__body">
          {renderStepContent()}
        </ModalBody>

        {/* Footer Navigation */}
        <div className="onboarding-modal__footer">
          <div className="onboarding-modal__progress">
            <div
              className="onboarding-modal__progress-track"
              role="progressbar"
              aria-label={_("Onboarding progress")}
              aria-valuemin={1}
              aria-valuemax={totalSteps}
              aria-valuenow={stepsCompleted}
            >
              <div
                className="onboarding-modal__progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="onboarding-modal__progress-text">
              {stepsLeftText}
            </span>
          </div>

          <div className="onboarding-modal__footer-nav">
            <div className="onboarding-modal__footer-left">
              {currentStep !== "language" && (
                <Button
                  variant="secondary"
                  onClick={handleBack}
                  isDisabled={isSubmitting}
                >
                  <ArrowLeftIcon /> {_("Back")}
                </Button>
              )}
            </div>
            <div className="onboarding-modal__footer-right">
              {currentStep === "congratulations" ? (
                <Button
                  variant="primary"
                  onClick={handleComplete}
                  isDisabled={!disclaimerAccepted || isSubmitting}
                  isLoading={isSubmitting}
                >
                  {_("Get Started")} <RocketIcon />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleNext}
                  isDisabled={!canProceed()}
                >
                  {_("Continue")} <ArrowRightIcon />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
