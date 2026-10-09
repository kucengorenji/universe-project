import { request, type TokenSource } from '../../api.ts';

/** Opens a player's cloud save read-only in the game (a 15-minute link). */
export async function openInspect(token: TokenSource, userId: string, worldId: string) {
  // Open the tab inside the click, before the request, so popup blockers allow it.
  const tab = window.open('', '_blank');
  try {
    const { url } = await request<{ url: string; expiresAt: number }>(token, '/admin/inspect', { method: 'POST', body: { userId, worldId } });
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else window.location.assign(url);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
