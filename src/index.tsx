/*
 * Cockpit AI Agent - Entry Point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

// Cockpit dark theme support (provided at runtime)
import "cockpit-dark-theme";

import { Application } from './app';

// PatternFly 6 styles
import "@patternfly/patternfly/patternfly.css";

// Custom styles
import './app.scss';

document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("app");
    if (container) {
        createRoot(container).render(<Application />);
    }
});
