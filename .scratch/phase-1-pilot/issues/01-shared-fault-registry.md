# 01: Shared Fault Registry (error_code Dictionary)

**What to build:** Establish the single flat JSON fault-code registry mapping each `error_code` to its canonical title, symptoms, and plain-English Markdown fix steps, validated by an automated schema check so firmware C++ enum generation and backend Glossary seeding share one source of truth.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Registry includes initial winding-room fault definitions covering common shop-floor faults (fiber snap, tension fault, motor or subsystem timeout, bobbin jam, and controller brownout or watchdog reset).
- [ ] Every entry defines a unique `error_code`, concise title, symptoms summary, and step-by-step plain-English Markdown fix instructions.
- [ ] Automated validation verifies required fields, non-empty strings, and unique `error_code` keys, rejecting duplicate or malformed entries.
- [ ] Registry format is flat JSON suitable for both C++ firmware enum generation and database Glossary seeding.
