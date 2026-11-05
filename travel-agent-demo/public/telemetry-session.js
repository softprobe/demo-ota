// Run before @softprobe/web so restored chats reuse their agent session immediately.
(() => {
  'use strict';
  try {
    const sessionId = sessionStorage.getItem('softprobe.travel.sessionId');
    if (/^ses_[A-Za-z0-9_-]+$/.test(sessionId || '')) sessionStorage.setItem('x-sp-session-id', sessionId);
  } catch { /* The chat handles unavailable browser storage separately. */ }
})();
