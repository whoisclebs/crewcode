import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

export type ApprovalMode = "manual" | "auto" | "observe" | "unguarded"

const MODES: readonly ApprovalMode[] = ["manual", "auto", "observe", "unguarded"]

// The server decides what happens to a request that needs approval. This only tells the interface which mode it is in.
export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const mode: ApprovalMode = MODES.find((item) => item === args.approval) ?? "manual"
    return {
      get mode() {
        return mode
      },
    }
  },
})
