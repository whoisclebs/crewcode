import { createSignal, onMount } from "solid-js"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { createSimpleContext } from "./helper"

export type ApprovalMode = "manual" | "auto" | "observe" | "unguarded"

const MODES: readonly ApprovalMode[] = ["manual", "auto", "observe", "unguarded"]

// The order the shortcut walks through. "unguarded" is not part of it: it can only be chosen with the --unguarded flag.
const CYCLE = ["manual", "auto", "observe"] as const

export const LABELS: Record<ApprovalMode, string> = {
  manual: "manual: you answer every request",
  auto: "auto: a reviewer answers what is clearly safe",
  observe: "observe: the reviewer only gives an opinion, you still answer",
  unguarded: "unguarded: everything is approved without review",
}

// The server decides what happens to a request that needs approval. This keeps the interface in step with it and asks it to switch.
export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const sdk = useSDK()
    const [mode, setMode] = createSignal<ApprovalMode>(MODES.find((item) => item === args.approval) ?? "manual")

    onMount(async () => {
      // The configuration file may set a mode the command line did not, so ask the server which one is in effect.
      try {
        const result = await sdk.client.permission.mode()
        if (result.data) setMode(result.data.mode)
      } catch {
        // Keep what the command line said; the indicator is informational.
      }
    })

    return {
      get mode() {
        return mode()
      },
      /** Moves to the next mode. Resolves to the mode in effect afterwards, or undefined if the server did not accept it. */
      async cycle(): Promise<ApprovalMode | undefined> {
        const current = mode()
        if (current === "unguarded") return current
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
        const result = await Promise.resolve()
          .then(() => sdk.client.permission.setMode({ mode: next }))
          .catch(() => undefined)
        if (!result?.data) return undefined
        setMode(result.data.mode)
        return result.data.mode
      },
    }
  },
})
