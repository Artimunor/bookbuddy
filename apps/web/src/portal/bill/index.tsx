  {bill.outcome.status === "due" && bill.state === "issued" && !bill.paymentInstructions && !bill.activeDeferral &&
    <Card title={t("web.portal.closeout.payDirect", { provider: data.job.providerDisplayName })}>
      <p>{t("web.portal.closeout.payUsingBill", { reference: bill.number })}</p>
    </Card>}