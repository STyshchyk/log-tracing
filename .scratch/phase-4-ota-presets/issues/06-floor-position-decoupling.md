# 06: Floor-Position Decoupling (`W-23` vs. ESP32 Hardware ID)

**What to build:** Decouple fixed physical room positions (e.g., `W-23`) from replaceable ESP32 hardware IDs and eliminate hardcoded `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, and `EAST_DOOR` zone labels.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Schema and `/fleet` floor map support fixed physical room positions decoupled from the currently assigned ESP32 hardware ID.
- [x] Hardcoded `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, and `EAST_DOOR` zone labels are removed from the UI and seeders.
- [x] Reassigning a replacement ESP32 to an existing physical position preserves the position's identity and history.
- [x] Integration tests verify position-to-ESP32 reassignment and `/fleet` rendering without legacy zone labels.
