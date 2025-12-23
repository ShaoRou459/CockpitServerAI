/*
 * Cockpit dark theme stub module
 * 
 * This module is a no-op stub. The actual cockpit-dark-theme
 * functionality is provided by Cockpit at runtime if the user
 * has dark mode enabled.
 */

// Check if Cockpit's dark theme support is available
if (typeof window !== 'undefined' && window.cockpit_dark_theme) {
    window.cockpit_dark_theme.init();
}

export default {};
