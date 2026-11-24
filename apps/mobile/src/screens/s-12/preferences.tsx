import { accountSettingsRoute, type AccountSettingsPatch, type SessionBootstrap } from "@bookbuddy/api-contract";
import type { LocaleTag } from "@bookbuddy/i18n/locales";
import { uuid } from "expo";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useCommand } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useLocale } from "../../i18n";
import { useRepository } from "../../repository/hooks";
import { useSession } from "../../session";
import { BeaconThemeProvider, type BeaconAppearance } from "../../ui/theme";

export type DisplaySettings = { readingLocale: string | null; twoClock: boolean; shareDisplayZone: boolean; fieldMode: boolean; theme: BeaconAppearance };
type DisplayPatch = Partial<DisplaySettings>;
type Phase = "saving" | "checking" | "unsaved" | "local";
type SaveIntent = { sessionId: string; operationId: string; expectedRevision: number; patch: AccountSettingsPatch; confirmed?: SessionBootstrap };

type DisplayAccess = {
  settings: DisplaySettings;
  phase?: Phase;
  choosingLocale: boolean;
  chooseLocale: (locale: LocaleTag) => Promise<void>;
  save: (patch: DisplayPatch) => Promise<void>;
  retry: () => Promise<void>;
};
const DisplayContext = createContext<DisplayAccess | null>(null);

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const { session, bootstrap, preferences, acceptBootstrap } = useSession();
  const { isOffline } = useApiAccess();
  const { chooseLocale } = useLocale();
  const scope = useRepository();
  const { run } = useCommand(accountSettingsRoute);
  const [transaction, setTransaction] = useState<{ intent: SaveIntent; phase: Phase }>();
  const [choosing, setChoosing] = useState(false);
  const inFlight = useRef(false);
  const current = transaction?.intent.sessionId === session?.sessionId ? transaction : undefined;
  const pending = current && current.phase !== "unsaved" ? current.intent.patch : undefined;
  const settings: DisplaySettings = {
    readingLocale: pending?.readingLocale === undefined ? preferences?.readingLocale ?? null : pending.readingLocale,
    twoClock: pending?.twoClock ?? preferences?.twoClock ?? false,
    shareDisplayZone: pending?.shareDisplayZone ?? preferences?.shareDisplayZone ?? false,
    fieldMode: pending?.fieldMode ?? preferences?.fieldMode ?? (session?.activeContext?.role === "worker"),
    theme: pending?.theme ?? preferences?.theme ?? "system",
  };

  async function apply(intent: SaveIntent) {
    if (inFlight.current || session?.sessionId !== intent.sessionId || (!intent.confirmed && isOffline())) return;
    inFlight.current = true;
    setTransaction({ intent, phase: "saving" });
    let completed = intent;
    try {
      if (!completed.confirmed) {
        const result = await run({ body: { operationId: intent.operationId, expectedRevision: intent.expectedRevision, payload: intent.patch } });
        if (!result.ok) {
          const uncertain = ("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR"
            || (current?.phase === "checking" && "delivery" in result.error && result.error.delivery === "not_sent");
          setTransaction({ intent, phase: uncertain ? "checking" : "unsaved" });
          return;
        }
        completed = { ...intent, confirmed: result.data };
      }
      if (scope && !scope.isActive) {
        setTransaction(undefined);
        return;
      }
      await acceptBootstrap(completed.confirmed!);
      setTransaction(undefined);
    } catch {
      setTransaction({ intent: completed, phase: completed.confirmed ? "local" : "checking" });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <DisplayContext.Provider value={{
      settings, phase: current?.phase, choosingLocale: choosing,
      chooseLocale: async (next) => {
        if (inFlight.current || (current && current.phase !== "unsaved")) return;
        inFlight.current = true;
        setChoosing(true);
        try { await chooseLocale(next); }
        finally { setChoosing(false); inFlight.current = false; }
      },
      save: async (patch) => {
        if (!bootstrap || (current && current.phase !== "unsaved")) return;
        const payload = patch.twoClock === undefined ? patch
          : { ...patch, displayZone: patch.twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null : null };
        await apply({ sessionId: bootstrap.sessionId, operationId: uuid.v4(), expectedRevision: bootstrap.preferences.revision, patch: payload });
      },
      retry: async () => {
        if (current && (current.phase === "checking" || current.phase === "local")) await apply(current.intent);
      },
    }}>
      <BeaconThemeProvider scheme={settings.theme} field={settings.fieldMode}>{children}</BeaconThemeProvider>
    </DisplayContext.Provider>
  );
}

export function useDisplaySettings(): DisplayAccess {
  const settings = useContext(DisplayContext);
  if (!settings) throw new Error("DisplaySettingsProvider is required");
  return settings;
}
