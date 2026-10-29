/**
 * Entry point used by the desktop app's "local workspace" mode: the API and web client
 * run inside the Electron main process, bound to 127.0.0.1 only.
 */
export { startServer } from './server.js';
export type { RunningServer } from './server.js';
