import { createWebTranslator } from "@bookbuddy/i18n/web";
import { useSession } from "./index";
import type { PendingOperationState } from "./pending-operation";

export function PendingReceiptNotice({ state }: { state: PendingOperationState }) {
  const { locale } = useSession();
  const { t } = createWebTranslator(locale);
  if (state === "unknown") return <p role="alert">{t("web.portal.auth.receiptUnknown")}</p>;
  if (state === "committed") return <p role="status">{t("web.portal.auth.receiptCommitted")}</p>;
  return null;
}
