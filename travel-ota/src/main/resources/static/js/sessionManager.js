/**
 * SessionId 管理器
 * 统一管理sessionId的生成和获取
 */

// 生成UUID函数
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 生成sessionId
function generateSessionId() {
    const uuid = generateUUID();
    return `sp-session-${uuid}`;
}

// 获取sessionId（从sessionStorage或生成新的）
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

// 重置sessionId（清除当前的并生成新的）
function resetSessionId() {
    sessionStorage.removeItem('x-sp-session-id');
    const newSessionId = generateSessionId();
    sessionStorage.setItem('x-sp-session-id', newSessionId);
    console.log('Reset sessionId:', newSessionId);
    return newSessionId;
}

// 获取当前sessionId（不生成新的）
function getCurrentSessionId() {
    return sessionStorage.getItem('x-sp-session-id');
}

// 自动初始化sessionId
function initSessionId() {
    const sessionId = getSessionId();
    console.log('SessionManager initialized with sessionId:', sessionId);
    return sessionId;
}

// 页面加载时自动初始化sessionId
document.addEventListener('DOMContentLoaded', function() {
    initSessionId();
});
