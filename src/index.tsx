/*
 * Cockpit AI Agent - Entry Point
 */

import React from "react";
import { createRoot } from "react-dom/client";

// Cockpit dark theme support (provided at runtime)
import "cockpit-dark-theme";

import { Application } from "./app";
import { I18nProvider } from "./lib/i18n";
import { loadSettings } from "./lib/settings";

// PatternFly 6 styles
import "@patternfly/patternfly/patternfly.css";

// Custom styles
import "./app.scss";

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("app");
  if (!container) {
    return;
  }

  const settings = await loadSettings().catch(() => null);
  const initialLanguage = settings?.language ?? "en";

  createRoot(container).render(
    <I18nProvider initialLanguage={initialLanguage}>
      <Application />
    </I18nProvider>,
  );
});
