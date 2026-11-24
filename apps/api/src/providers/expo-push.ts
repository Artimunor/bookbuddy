import type { OpaqueLinkUrl } from "@bookbuddy/api-contract";

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { url: OpaqueLinkUrl };
}

type Rejected = { state: "rejected"; deviceNotRegistered: boolean };
type Unknown = { state: "unknown" };
export type ExpoTicket = { state: "accepted"; id: string } | Rejected | Unknown;
export type ExpoReceipt = { state: "delivered" } | Rejected | Unknown;
export type ExpoFetch = (url: string, request: RequestInit) => Promise<Response>;

const endpoint = "https://exp.host/--/api/v2/push";
const maxNotices = 100;
export const maxReceiptIds = 1_000;
const unknown: Unknown = { state: "unknown" };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rejected(row: Record<string, unknown>): Rejected {
  return { state: "rejected", deviceNotRegistered: record(row.details)?.error === "DeviceNotRegistered" };
}

function ticket(value: unknown): ExpoTicket {
  const row = record(value);
  if (row?.status === "error") return rejected(row);
  if (row?.status === "ok" && typeof row.id === "string" && row.id.length > 0) return { state: "accepted", id: row.id };
  return unknown;
}

function receipt(value: unknown): ExpoReceipt {
  const row = record(value);
  if (row?.status === "error") return rejected(row);
  return row?.status === "ok" ? { state: "delivered" } : unknown;
}

export function createExpoPush(accessToken?: string, transport: ExpoFetch = fetch) {
  const headers = { "Content-Type": "application/json", Accept: "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  async function post(path: "send" | "getReceipts", body: unknown) {
    try {
      const response = await transport(`${endpoint}/${path}`, {
        method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      const json = response.ok ? record(await response.json()) : null;
      return json?.data;
    } catch {
      // Even a timeout may follow acceptance by Expo. Never resend the alert.
      return undefined;
    }
  }
  return {
    async send(messages: readonly ExpoMessage[]): Promise<ExpoTicket[]> {
      const pending: Promise<ExpoTicket[]>[] = [];
      for (let i = 0; i < messages.length; i += maxNotices) {
        const batch = messages.slice(i, i + maxNotices);
        pending.push(post("send", batch).then((data) => Array.isArray(data) && data.length === batch.length
          ? data.map(ticket) : batch.map(() => unknown)));
      }
      return (await Promise.all(pending)).flat();
    },
    async receipts(ids: readonly string[]): Promise<ExpoReceipt[]> {
      const pending: Promise<ExpoReceipt[]>[] = [];
      for (let i = 0; i < ids.length; i += maxReceiptIds) {
        const batch = ids.slice(i, i + maxReceiptIds);
        pending.push(post("getReceipts", { ids: batch }).then((data) => {
          const rows = record(data);
          return batch.map((id) => rows && Object.hasOwn(rows, id) ? receipt(rows[id]) : unknown);
        }));
      }
      return (await Promise.all(pending)).flat();
    },
  };
}
