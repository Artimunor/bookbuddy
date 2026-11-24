import type { ScreenPreview } from "../../preview/screens/types";
import { PreviewLocaleProvider } from "../../i18n";
import { WelcomeView } from "./Screen";

export const previews: ScreenPreview[] = [
  { id: "S-01", state: "welcome", render: () => <WelcomeView onStart={() => {}} /> },
  { id: "S-01", state: "portuguese", render: () => (
    <PreviewLocaleProvider initialLocale="pt-PT"><WelcomeView onStart={() => {}} /></PreviewLocaleProvider>
  ) },
  { id: "S-01", state: "unsupported-language", render: () => (
    <PreviewLocaleProvider deviceLanguageSupported={false}><WelcomeView onStart={() => {}} /></PreviewLocaleProvider>
  ) },
  { id: "S-01", state: "invite-detected", render: () => <WelcomeView link="invite" onStart={() => {}} /> },
  { id: "S-01", state: "update-detected", render: () => <WelcomeView link="update" onStart={() => {}} /> },
];
