import { at } from "../access/policy";

export const noMediaDeadline = String(Number.MAX_SAFE_INTEGER);

export const mediaLinkDeadline = (job: string, attachment: string, purpose: "progress" | "ordinary") =>
  `coalesce((SELECT d.expires_at FROM job_media_deadlines d
    WHERE d.job_id = ${job} AND d.attachment_id = ${attachment} AND d.purpose = '${purpose}'), ${noMediaDeadline})`;

export const mediaLinkAvailable = (job: string, attachment: string, purpose: "progress" | "ordinary") =>
  `${mediaLinkDeadline(job, attachment, purpose)} > ${at}`;
