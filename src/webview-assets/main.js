// Minimal bootstrap for the webview; core logic is in TS files compiled to this bundle.

import('./prompter.js').then(() => {
  console.log('[clPrompter] Webview initialized successfully');
}).catch(err => {
  console.error('[clPrompter] Failed to load prompter:', err);
});