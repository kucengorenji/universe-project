import { showNotice } from './notice.js';

// A short notice from anywhere (the planet menu, the director when a place failed to load, the First
// Journey). It goes through the shared message slot under the objective bar; see notice.js.
export function flashToast(message, ms = 2800, kind = 'info') {
  showNotice({ message, ms, kind });
}
