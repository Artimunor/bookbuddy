import { native } from "@bookbuddy/design-tokens";
import { createContext, useContext, type ReactNode } from "react";
import { useColorScheme } from "react-native";

type Scheme = keyof typeof native.colors;
export type BeaconAppearance = "system" | Scheme;

export type BeaconTheme = {
  scheme: Scheme;
  field: boolean;
  color: (typeof native.colors)[Scheme];
  type: typeof native.typography;
  space: typeof native.spacing;
  radius: typeof native.radii;
  motion: typeof native.motion;
};

function theme(scheme: Scheme, field: boolean): BeaconTheme {
  return {
    scheme,
    field,
    color: native.colors[scheme],
    type: native.typography,
    space: native.spacing,
    radius: native.radii,
    motion: native.motion,
  };
}

const standardThemes = { light: theme("light", false), dark: theme("dark", false) };
const fieldThemes = { light: theme("light", true), dark: theme("dark", true) };
const ThemeContext = createContext<BeaconTheme | undefined>(undefined);

export type BeaconThemeProviderProps = {
  scheme?: BeaconAppearance;
  field?: boolean;
  children: ReactNode;
};

export function BeaconThemeProvider({ scheme = "system", field = false, children }: BeaconThemeProviderProps) {
  const system = useColorScheme();
  const selected = scheme === "system" ? (system === "dark" ? "dark" : "light") : scheme;
  return <ThemeContext.Provider value={(field ? fieldThemes : standardThemes)[selected]}>{children}</ThemeContext.Provider>;
}

export function useBeaconTheme(): BeaconTheme {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("Beacon controls require a BeaconThemeProvider");
  return value;
}
