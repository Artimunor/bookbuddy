# Mobile offline data

Sync stores `notification` rows with only `id`, `kind`, `createdAt` and `readAt`. Opted-in GETs store safe `home`, `jobs_list`, `shift_agenda`, `crew_availability` and `notification` pages. `remote-cache.ts` defines each nested field allowlist. It never stores notification link tokens, residential aliases or addresses, access notes, bills, payment instructions or received media. Unknown routes and fields are not cached.

Only the active account and context can read a snapshot. Each cached GET expires 72 hours after its own confirmation; a sync without a fresh GET does not extend that window. A scope removal clears cached data before replacement rows are written. A disconnect hides unpersisted online data until a fresh grant read; reconnect alone does not fetch. Sign-out removes all partitions and the account's non-credential bootstrap. The bearer stays in device-only SecureStore.

Authored drafts use `kind:id` keys, such as `request:new`. They warn at 11 idle days and expire at 14. Stable operation IDs and staged outgoing media metadata are separate from cached snapshots. Online-only operations have receipt keys, not executable payloads, and are never replayed by sync.

Native uses a device-only SecureStore key and SQLCipher. The iOS config plugin excludes `BookBuddyOffline` from backups before the repository opens; this requires a native build, not Expo Go. Stage outgoing files under `stagedMediaDirectory()` so sign-out can remove them alongside all partitions for the account. The React Native Web gallery uses a preview-only in-memory executor; it does not keep a database between page loads or use the deployment's API URL.
