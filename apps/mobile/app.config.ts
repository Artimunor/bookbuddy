import type { ConfigContext, ExpoConfig } from "expo/config";
import { readBuildInputs } from "./config-inputs.cjs";

export default function configureApp({ projectRoot }: ConfigContext): ExpoConfig {
  const { linkHost, supportedLocales, supportsRTL } = readBuildInputs(projectRoot);
  const identifier = "app.bookbuddy.mobile";
  const apiBaseUrl = process.env.BOOKBUDDY_API_BASE_URL
    ?? (process.env.APP_ENV === "local" ? "http://localhost:8787/api/v1" : undefined);

  return {
    name: "BookBuddy",
    slug: "bookbuddy",
    scheme: "bookbuddy",
    ios: {
      bundleIdentifier: identifier,
      ...(linkHost && { associatedDomains: [`applinks:${linkHost}`] }),
    },
    android: {
      package: identifier,
      allowBackup: false,
      ...(linkHost && {
        intentFilters: [
          {
            action: "VIEW",
            autoVerify: true,
            category: ["DEFAULT", "BROWSABLE"],
            data: [{ scheme: "https", host: linkHost, pathPrefix: "/l/" }],
          },
        ],
      }),
    },
    web: { bundler: "metro", output: "single" },
    extra: { apiBaseUrl },
    plugins: [
      "expo-router",
      "expo-dev-client",
      ["expo-localization", { supportedLocales, supportsRTL }],
      ["expo-sqlite", { useSQLCipher: true }],
      "./src/repository/with-ios-offline-directory.cjs",
    ],
    experiments: { typedRoutes: true },
  };
}
