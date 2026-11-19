# 06: Fleet UI drill-down drawer, status filters, Room History & Master Glossary

**What to build:** Wire interactive filtering and detail inspection inside `/fleet`: status filter pills (`All`, `Working`, `Idle`, `Error`, `Offline`) on the floor map, a native modal `<dialog closedby="any">` machine drill-down drawer fetching `/api/fleet/machines/:id/details`, filterable Room History feed (`kind`, `zone`, `machineId`), and live-searchable Master Glossary tab.

**Blocked by:** 02: Fleet machine-details API, 05: Fleet PWA shell, L-shaped floor map & summary strip

**Status:** done

- [x] Status filter pills toggle map visibility/counts accurately with accessible `aria-pressed` and live count feedback.
- [x] Clicking any machine button on the map or Room History opens `<dialog id="machine-drawer" closedby="any">` via `showModal()`, prevents background scroll chaining (`overscroll-behavior: contain`), supports light-dismiss (including Safari pointer fallback) and `Close` button, and renders sanitized details, active glossary fix steps, 4-window coil rollups, recent errors, bug reports, and Worker Portal link.
- [x] Room History filters and Master Glossary live search query the API cleanly without XSS exposure.
