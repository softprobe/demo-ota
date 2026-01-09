/**
 * SessionId manager
 * Centralized sessionId creation and retrieval
 */

// Generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Generate sessionId
function generateSessionId() {
    const uuid = generateUUID();
    return `sp-session-${uuid}`;
}

// Get sessionId (from sessionStorage or generate a new one)
function getSessionId() {
    let sessionId = sessionStorage.getItem('x-sp-session-id');
    if (!sessionId) {
        sessionId = generateSessionId();
        sessionStorage.setItem('x-sp-session-id', sessionId);
        console.log('Generated new sessionId:', sessionId);
    } else {
        console.log('Using existing sessionId:', sessionId);
    }
    return sessionId;
}

// Reset sessionId (clear current and generate a new one)
function resetSessionId() {
    sessionStorage.removeItem('x-sp-session-id');
    const newSessionId = generateSessionId();
    sessionStorage.setItem('x-sp-session-id', newSessionId);
    console.log('Reset sessionId:', newSessionId);
    return newSessionId;
}

// Get current sessionId (do not generate a new one)
function getCurrentSessionId() {
    return sessionStorage.getItem('x-sp-session-id');
}

// Auto-initialize sessionId
function initSessionId() {
    const sessionId = getSessionId();
    console.log('SessionManager initialized with sessionId:', sessionId);
    return sessionId;
}

// Initialize sessionId on page load
document.addEventListener('DOMContentLoaded', function() {
    initSessionId();
});
