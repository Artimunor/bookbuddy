import { app } from "../src/app";
import type { Bindings } from "../src/bindings";
import { localMailDelivery } from "../src/config";
import { runEffectBatch } from "../src/effects";
import { isSyntheticMailbox } from "../src/providers/mail";
import type { MailDelivery } from "../src/providers/mail";
import { TestD1 } from "../test/d1";
import { fixtureBindings, hostname, localRequest, port } from "./config";
import { openBunDatabase } from "./db";

const [path, ...extra] = Bun.argv.slice(2);
if (!path || extra.length) throw new Error("Usage: bun apps/api/dev/server.ts <bun-demo-database.sqlite>");
const config = await fixtureBindings();
const DB = new TestD1(await openBunDatabase(path));

function unavailable(feature: string): never {
  throw new Error(`${feature} is unavailable in the Bun demo API`);
}

const live = {
  getByName: () => ({ async publishInvalidation() { unavailable("Live invalidation"); }, async closeSession() {} }),
} as unknown as Bindings["LIVE"];
const delivery = { metadata: { get metrics() { return unavailable("Queue metrics"); } } };
const fixtureMail: MailDelivery = {
  async send(message) {
    if (config.OTP_DEV_LOG_CODE === "true" && message.syntheticOtp && isSyntheticMailbox(message.to)) {
      console.info("bookbuddy.mail.fixture_code", message.syntheticOtp);
    } else {
      console.info("bookbuddy.mail.dev_delivery");
    }
    return { state: "delivered" };
  },
};
const noVendorFetch = async () => unavailable("Push provider HTTP");
let drain = Promise.resolve();

const server = Bun.serve({
  hostname,
  port,
  async fetch(incoming) {
    const request = localRequest(incoming);
    if (!request) return new Response("Local API only", { status: 403 });
    let keys: Set<string> | undefined;
    let background: Promise<unknown>[] | undefined;
    const env: Bindings = {
      ...config,
      [localMailDelivery]: fixtureMail,
      DB,
      get EVIDENCE() { return unavailable("Evidence storage"); },
      LIVE: live,
      EFFECTS: {
        async send(wake) {
          const queued = keys ??= new Set();
          for (const key of wake.workKeys) queued.add(key);
          return delivery;
        },
        async sendBatch() { return unavailable("Queue batch sends"); },
        async metrics() { return unavailable("Queue metrics"); },
      },
    };
    const response = await app.fetch(request, env, {
      waitUntil(promise: Promise<unknown>) { (background ??= []).push(promise); },
      passThroughOnException() { unavailable("Worker exception forwarding"); },
      props: {},
    });
    if (keys || background) {
      // Run the Worker's durable outbox consumer after returning the response.
      // SQL and claim fencing are shared; the transports are local-only.
      setImmediate(() => {
        drain = drain.then(async () => {
          if (background) await Promise.allSettled(background);
          if (keys?.size) await runEffectBatch(env, [...keys], undefined, noVendorFetch);
        }).catch((error: unknown) => console.error("Bun demo effect failed", error));
      });
    }
    return response;
  },
});
console.info(`Bun demo API listening on loopback port ${server.port}`);
