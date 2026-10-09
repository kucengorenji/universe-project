// One transient notice at the bottom of the screen, shared by the planet menu and the
// director (a place that failed to load). The element is created on first use.
let timer = null;

export function flashToast(message, ms = 2800) {
  if (typeof document === 'undefined') return;
  let toast = document.getElementById('toastNotice');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotice';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove('show'), ms);
}
