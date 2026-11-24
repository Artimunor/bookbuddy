# Local status cards

Status cards are disabled on a fresh device. On a signed internal spike build only, call `setStatusCardPreferences({ statusCardsEnabled: true })` from the app to enable the device setting. Do not change the shipping default before the spike passes. Hide Details stays on until separately changed in Live updates and privacy.

Expo prebuild adds the `BookBuddyStatusWidget` WidgetKit extension and enables `NSSupportsLiveActivities`. The local Expo module requests ActivityKit with no push type. Android uses a dedicated low-importance channel and permission flow from `expo-notifications`; the native standard notification builder supplies separate expanded text, a private/public preview, and an OS timeout. There is no Android 16 promotion. Card taps are record links, not actions.

A signed iOS/Android device run must verify permission denial, cold and warm record taps, generic previews with VoiceOver/TalkBack, immediate redaction, dismissal, session changes, and stopping at check-out or expiry. Confirm that the Island timer and Android timeout stop without the app open. On iOS, the stale date can redact an earlier product expiry, while ActivityKit itself enforces the eight-hour limit from the activity’s start; a suspended app cannot invoke an early explicit `end`. Android needs API 26 or newer for an OS timeout; when a timed snapshot would become stale with no runtime, it is removed rather than presented as current.

The signed-device spike has not run. Native compilation requires Xcode and the Android SDK. `0013_system_status.sql` is intentionally absent: local cards have no installation subscription, activity push token, remote start, or remote update. Ordinary alerts and in-app status remain independent.
