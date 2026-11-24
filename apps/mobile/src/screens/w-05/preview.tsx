import type { ScreenPreview } from "../../preview/screens/types";
import { Screen } from "../../ui/controls";
import { DecisionSheet, type DecisionMode } from "./Screen";
const noop = () => {};
export const previews: ScreenPreview[] = ["decline", "withdraw", "dropout", "not-sent"].map(state => ({ id: "W-05", state, render: () => <Screen title="Villa Mar"><DecisionSheet visible mode={(state === "not-sent" ? "dropout" : state) as DecisionMode} detail="Terrace door repair · 09:00" offline={state === "not-sent"} busy={false} checking={false} failed={false} onClose={noop} onSubmit={noop} /></Screen> }));
