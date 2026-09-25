import type { DemoBackend } from './backend';

/** The demo's backend, set once by `installDemo`. */
export const runtime: { backend?: DemoBackend } = {};
