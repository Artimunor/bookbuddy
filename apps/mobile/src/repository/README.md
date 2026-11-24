# Mobile offline data

Sync stores `notification` rows with only `id`, `kind`, `createdAt` and `readAt`, and `worker_field_shift` for the active worker, keyed by assignment ID. The latter keeps booking times, work and hold states, and attendance evidence. Opted-in GETs store safe `home`, `jobs_list`, `shift_agenda`, `crew_availability` and `notification` pages. The field allowlists in `cache.ts` and `remote-cache.ts` exclude residential aliases, addresses, access details, bills, payment instructions, notification link tokens and received media.

Only the active account and context can read a snapshot. Each cached GET expires 72 hours after its own confirmation; a sync without a fresh GET does not extend that window. A scope removal clears cached data before replacement rows are written. A disconnect hides unpersisted online data until a fresh grant read; reconnect alone does not fetch. Sign-out removes all partitions and the account's non-credential bootstrap. The bearer stays in device-only SecureStore.

Authored drafts use `kind:id` keys, such as `request:new`. They warn at 11 idle days and expire at 14. Stable operation IDs and staged outgoing media metadata are separate from cached snapshots. Online-only operations have receipt keys, not executable payloads, and are never replayed by sync.

Attendance captures use a stable operation ID. Acknowledged captures leave the outbox even if the assignment projection is on a later page. Only the matching attendance event or its review ID can mark a capture recorded or needing review. A lost response leaves it Checking with the original ID.

Native uses a device-only SecureStore key and SQLCipher. The iOS config plugin excludes `BookBuddyOffline` from backups before the repository opens; this requires a native build, not Expo Go. Stage outgoing files under `stagedMediaDirectory()` so sign-out can remove them alongside all partitions for the account. The React Native Web gallery uses a preview-only in-memory executor; it does not keep a database between page loads or use the deployment's API URL.
