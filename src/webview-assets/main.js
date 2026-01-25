// Minimal bootstrap for the webview; core logic is in TS files compiled to this bundle.

// Assume TS is compiled to a bundle (e.g., via Webpack); import and initialize
import('./prompter.js').then(() => {
  console.log('[clPrompter] Webview initialized');
}).catch(err => {
  console.error('[clPrompter] Failed to load prompter:', err);
});