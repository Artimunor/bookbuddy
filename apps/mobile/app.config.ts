import type { ConfigContext, ExpoConfig } from "expo/config";
import { readBuildInputs } from "./config-inputs.cjs";

export default function configureApp({ projectRoot }: ConfigContext): ExpoConfig {
  const { linkHost, supportedLocales, supportsRTL } = readBuildInputs(projectRoot);
  const identifier = "app.bookbuddy.mobile";
  const local = process.env.APP_ENV === "local";
  const apiBaseUrl = process.env.BOOKBUDDY_API_BASE_URL
    ?? (local ? "http://localhost:8787/api/v1" : undefined);

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
    extra: { apiBaseUrl, ...(local ? { localWebApi: true } : {}), ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}) },
    plugins: [
      "expo-router",
      "expo-dev-client",
      "expo-notifications",
      ["expo-localization", { supportedLocales, supportsRTL }],
      ["expo-sqlite", { useSQLCipher: true }],
      "./src/repository/with-ios-offline-directory.cjs",
    ],
    experiments: { typedRoutes: true },
  };
}
