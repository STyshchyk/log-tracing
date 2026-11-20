# 03: Department Heads /fleet UI update for ESP32 cycle telemetry

**What to build:** Update `src/ui/fleet-layout.ts` (SSR HTML and inline client JS) so the Department Heads `/fleet` summary strip and `<dialog>` drill-down drawer display ESP32 internal cycle telemetry (`Winding Cycles (ESP32)`: `Auto-Finished`, `Aborted`, `Fault-Stopped`, `Wound Fiber`) instead of CRM-like `Completed` / `Aborted` / `Completion` labels.

**Blocked by:** 02: ESP32 cycle rollup query services & OpenAPI JSON endpoints

**Status:** done

- [x] Summary strip card renders **Winding Cycles (ESP32)** with `Auto-Finished`, `Aborted`, `Fault-Stopped`, and `Wound Fiber` totals and updates dynamically across `Today`, `Week`, `Month`, and `All-Time` toggles as well as 10-second polling.
- [x] Machine drill-down `<dialog>` table renders **Winding Cycle Telemetry (ESP32)** with `Window`, `Auto-Finished`, `Aborted`, `Fault-Stopped`, `Total`, and `Wound Fiber` columns.
- [x] Rendered HTML and client script remain zero-CDN, accessible, XSS-safe, and free of CRM labels (`Completed`, `Completion`, `Redo`).
