import { useState, type ComponentProps } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { YouFixture, providerChoices } from "../s-06/preview";
import type { RoleChoice } from "../s-06/account";
import { SwitchRoleView } from "./Screen";

function Fixture(props: Pick<ComponentProps<typeof SwitchRoleView>, "drafts" | "offline" | "link" | "state">) {
  const [visible, setVisible] = useState(true);
  const [selected, setSelected] = useState<RoleChoice | undefined>(providerChoices[1]);
  return <>
    <YouFixture />
    {visible && <SwitchRoleView {...props} choices={props.link ? providerChoices.slice(1) : providerChoices} name="Mateo Ruiz"
      active={providerChoices[0]} selected={selected} onSelect={setSelected} onClose={() => setVisible(false)} onSwitch={() => setVisible(false)} />}
  </>;
}

export const previews: ScreenPreview[] = [
  { id: "S-07", state: "multiple", render: () => <Fixture /> },
  { id: "S-07", state: "pending-draft", render: () => <Fixture drafts={1} /> },
  { id: "S-07", state: "link-driven", render: () => <Fixture link /> },
  { id: "S-07", state: "offline", render: () => <Fixture offline drafts={1} /> },
  { id: "S-07", state: "checking", render: () => <Fixture state="checking" /> },
];
