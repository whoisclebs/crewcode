export * as PermissionV1 from "./permission"

import { Schema } from "effect"
export * from "@crewcode/schema/permission-v1"
import { ID } from "@crewcode/schema/permission-v1"

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export class ReviewDeniedError extends Schema.TaggedErrorClass<ReviewDeniedError>()("PermissionReviewDeniedError", {
  reason: Schema.String,
}) {
  override get message() {
    return `The automatic permission reviewer blocked this tool call: ${this.reason}. Try a different or more restrictive approach, or ask the user.`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError | ReviewDeniedError
