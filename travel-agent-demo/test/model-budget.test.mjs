import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelBudget } from '../src/model-budget.mjs';

test('a real pre-provider hook rejects the 36th model call for the same user turn', () => {
  const budget = new ModelBudget({ maxCalls: 35 });
  for (let i = 0; i < 35; i += 1) budget.beforeCall({ sessionID: 'ses_offline', message: { id: 'msg_turn_1' } }, {});
  assert.throws(() => budget.beforeCall({ sessionID: 'ses_offline', message: { id: 'msg_turn_1' } }, {}), /model-call limit/);
  assert.doesNotThrow(() => budget.beforeCall({ sessionID: 'ses_offline', message: { id: 'msg_turn_2' } }, {}));
  assert.throws(() => budget.beforeCall({ sessionID: 'ses_offline', message: {} }, {}), /identity/);
});

test('the hook caps actual provider output parameters without increasing a lower cap', () => {
  const budget = new ModelBudget({ maxCalls: 35 });
  const params = { maxOutputTokens: 32_000 };
  budget.beforeCall({ sessionID: 'ses_offline', message: { id: 'msg_output' } }, params);
  assert.equal(params.maxOutputTokens, 1024);
  const lower = { maxOutputTokens: 512 };
  budget.beforeCall({ sessionID: 'ses_offline', message: { id: 'msg_output' } }, lower);
  assert.equal(lower.maxOutputTokens, 512);
});
