/*
 * Cockpit stub module for bundling
 * 
 * This is a passthrough module that exports the cockpit object
 * provided globally by Cockpit's base1/cockpit.js at runtime.
 * 
 * When the plugin is loaded in Cockpit, the cockpit object is
 * available on the window and this module just re-exports it.
 */

const cockpit = window.cockpit;

// Re-export cockpit as default
export default cockpit;

// Named exports for common APIs
export const file = cockpit?.file?.bind(cockpit);
export const spawn = cockpit?.spawn?.bind(cockpit);
export const gettext = cockpit?.gettext || ((x) => x);
export const format = cockpit?.format || ((f, ...args) => f);
export const transport = cockpit?.transport;
export const http = cockpit?.http?.bind(cockpit);
