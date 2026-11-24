import type { ScreenPreview } from "../../preview/screens/types";
import { crewDetails, details } from "../s-10/preview";
import { ChatDetailsView } from "./Screen";
const noop = () => {};
export const previews: ScreenPreview[] = [
 { id: "S-13", state: "job", render: () => <ChatDetailsView data={details} onClose={noop} onLanguage={noop} onHelp={noop} /> },
 { id: "S-13", state: "crew-only", render: () => <ChatDetailsView data={crewDetails} onClose={noop} onLanguage={noop} onHelp={noop} /> },
];
