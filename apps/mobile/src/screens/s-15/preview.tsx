import { useFormat, useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { trackPhoto } from "../c-02/attachment-fixtures";
import { PhotoPreview } from "./Photo";
import { PhotoContext, PreviewFrame } from "./Screen";

const noop = () => {};
const caption = { original: "Rodillos viejos fuera", originalLanguage: "es", translation: "Old rollers out", translationLanguage: "en" };

function PhotoFixture() {
  const t = useT();
  const format = useFormat();
  const author = `Mateo Ruiz · ${t("mobile.provider.foremanRole")}`;
  const time = format.lines(Date.UTC(2026, 10, 24, 8, 36), "Europe/Madrid")?.site;
  return <PreviewFrame title={t("mobile.media.photo")} context="Terrace door repair · BB-1042" close={noop}>
    <PhotoPreview uri={trackPhoto} description={t("mobile.media.photoBy", { description: caption.translation, author })} onError={noop} />
    <PhotoContext author={author} time={time} caption={caption} />
  </PreviewFrame>;
}

export const previews: ScreenPreview[] = [{ id: "S-15", state: "photo", render: PhotoFixture }];
