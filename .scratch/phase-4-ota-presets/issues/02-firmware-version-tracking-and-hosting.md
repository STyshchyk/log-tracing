# 02: Firmware Version Tracking & Release Hosting

**What to build:** Track each machine's reported `fw_version` and `preset_version` from MQTT `status` messages, host uploaded `.bin` firmware releases with SHA-256 checksums, and provide an authenticated "Check Updates" comparison endpoint.

**Blocked by:** 01: Firmware & Preset Spec Contract (`spec/`)

**Status:** done

- [x] `machines` table stores `fw_version` and `preset_version`; `status` MQTT ingestion persists them when present.
- [x] `firmware_releases` table stores uploaded `.bin` metadata (`version`, `sha256`, `file_path`, `notes`, `created_at`).
- [x] Authenticated `/api/fleet/firmware` endpoints support uploading a `.bin` release, listing releases, and checking which machines are outdated.
- [x] LAN HTTP download endpoint serves the exact `.bin` bytes for a release.
- [x] Integration tests verify version persistence, `.bin` upload/download byte & SHA-256 integrity, and outdated-machine detection.
