# 11: Worker Portal Report-a-Bug Form & Confirmation UI

**What to build:** Build the mobile-first `Report a Bug` screen on the Worker Portal with large 1-tap quick tags, an optional standard text note field, and immediate submission confirmation.

**Blocked by:** 05: Worker Portal Landing Shell & Unknown-Machine Handling, 10: Bug Report API with Auto-Attached 20-Event Snapshot

**Status:** done

- [x] Tapping `Report a Bug` from the machine landing screen presents large, touch-friendly 1-tap quick-tag choices (`Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`) and a standard plain-text textarea (compatible with Android's built-in keyboard mic; zero custom Web Speech API and zero photo-upload controls).
- [x] Submitting with a quick tag (with or without a note) saves the bug report with the auto-attached telemetry snapshot and displays clear confirmation feedback with a return link to the machine home screen.
- [x] Submission disables or guards against accidental double-taps to avoid duplicate bug reports on handheld touchscreens.
- [x] Missing quick tag selection produces clear inline validation feedback without losing typed notes.
- [x] Verified end-to-end via Fastify `app.inject()` confirming form submission persists the bug report and renders confirmation.
