import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@crewcode/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~crewcode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~crewcode/WorkspaceRef", {
  defaultValue: () => undefined,
})
