// Runs in OpenCode's chat.params hook BEFORE provider preparation/dispatch.
// v1.18.30 Plugin.trigger propagates hook errors; LLMRequestPrep awaits it.
export class ModelBudget {
  constructor({ maxCalls = 35 } = {}) {
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 35) throw new Error('Invalid demo model-call cap.');
    this.maxCalls = maxCalls;
    this.calls = new Map();
  }

  beforeCall(input, params) {
    const sessionId = input?.sessionID;
    const messageId = input?.message?.id;
    if (typeof sessionId !== 'string' || !sessionId || typeof messageId !== 'string' || !messageId) throw new Error('The real user-turn identity is required before a model call.');
    const key = `${sessionId}\u0000${messageId}`;
    if (!this.calls.has(key) && this.calls.size >= 512) throw new Error('The local model-budget ledger is full; restart only after resolving active turns.');
    const used = this.calls.get(key) ?? 0;
    if (used >= this.maxCalls) throw new Error('This short test turn reached its hard model-call limit. No further provider call was sent.');
    this.calls.set(key, used + 1);
    params.maxOutputTokens = Number.isFinite(params.maxOutputTokens) && params.maxOutputTokens > 0 ? Math.min(params.maxOutputTokens, 1024) : 1024;
  }
}
