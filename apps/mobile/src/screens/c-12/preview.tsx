import { ratingEligibilitySchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { job } from "../c-10/preview";
import { RatingView } from "./Screen";
const eligible = ratingEligibilitySchema.parse({ status: "eligible", job, expiresAt: Date.parse("2026-12-24T09:00:00Z"), audience: { author: true, bookBuddyFeedbackTeam: true, providerFeedbackLead: true } });
const submitted = ratingEligibilitySchema.parse({ status: "submitted", job, rating: { id: "rating-1", jobId: job.jobId, stars: 4, comment: null, submittedAt: Date.parse("2026-11-25T09:10:00Z"), state: "submitted", audience: { author: true, bookBuddyFeedbackTeam: true, providerFeedbackLead: true } } });
const noop = () => {}; const props = { status: "ready" as const, receipt: null, comment: "", onStars: noop, onComment: noop, onSend: noop, onClose: noop, onRetry: noop };
export const previews: ScreenPreview[] = [
  { id: "C-12", state: "unrated", render: () => <RatingView {...props} data={eligible} commandState="idle" stars={0} /> },
  { id: "C-12", state: "chosen", render: () => <RatingView {...props} data={eligible} commandState="idle" stars={4} comment="Quick and tidy, and the updates were clear all morning." /> },
  { id: "C-12", state: "submitting", render: () => <RatingView {...props} data={eligible} commandState="sending" stars={4} /> },
  { id: "C-12", state: "submitted", render: () => <RatingView {...props} data={submitted} commandState="idle" stars={4} twoClock /> },
];
