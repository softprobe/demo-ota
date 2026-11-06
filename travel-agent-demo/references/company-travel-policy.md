# Company Travel Policy

- Policy ID: `policy-travel-approval`
- Version: `1.0`
- Rule ID: `TRV-01`

## §2.1 Manager approval above $600

Flights costing more than **$600 USD** require manager approval **before** the agent creates a booking. The traveler's confirmation does not count as manager approval.

For this synthetic demo:

- A USD flight priced at $600 or less does not need this additional approval.
- A USD flight priced above $600 remains awaiting manager approval after the traveler confirms. No reservation is created while that approval is missing.
- Non-USD fares are blocked because the demo does not perform currency conversion.
- There is no live manager workflow or manager inbox. The normal path records the pending approval requirement and stops.

## Controlled silent-bug simulation

The visitor can explicitly enable **Inject silent bug** and then confirm the exact prepared booking. This request-local simulation skips only the manager-approval gate. It does not change the chosen flight, fare or synthetic traveler, bypass traveler confirmation, make a payment, or issue a ticket.

The normal booking validation, independent order read-back, expiry, concurrency and no-retry protections remain active. A successful injected booking records its explicit manager-approval state and simulation metadata in the tool result.
