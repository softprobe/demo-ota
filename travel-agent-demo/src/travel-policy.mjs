export const TRAVEL_POLICY = Object.freeze({
  policyId: 'policy-travel-approval',
  ruleId: 'TRV-01',
  policyVersion: '1.0',
  name: 'Company Travel Policy',
  threshold: 600,
  currency: 'USD',
  text: 'Flights costing more than $600 USD require manager approval before booking. The traveler’s confirmation does not count as manager approval.',
});

export function managerApprovalFor(offer) {
  const { policyId, ruleId, policyVersion, threshold, currency } = TRAVEL_POLICY;
  return {
    policyId, ruleId, policyVersion, threshold, currency,
    status: offer.currency !== currency ? 'unsupported_currency' : offer.total > threshold ? 'not_requested' : 'not_required',
    requestedAt: null,
  };
}
