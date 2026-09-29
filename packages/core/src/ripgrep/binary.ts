import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { which } from "../util/which"

export namespace RipgrepBinary {
  export const INSTALL_HINT =
    "ripgrep (rg) is required but was not found in PATH. Install it from your package manager, for example: apt install ripgrep / brew install ripgrep"

  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("RipgrepBinary.NotFoundError", {
    message: Schema.String,
  }) {}

  interface Interface {
    readonly filepath: Effect.Effect<string, NotFoundError>
  }

  export class Service extends Context.Service<Service, Interface>()("@crewcode/RipgrepBinary") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const filename = process.platform === "win32" ? "rg.exe" : "rg"

      return Service.of({
        filepath: yield* Effect.cached(
          Effect.gen(function* () {
            const system = yield* Effect.sync(() => which(filename))
            if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

            const managed = path.join(Global.Path.bin, filename)
            if (yield* fs.isFile(managed).pipe(Effect.orDie)) return managed

            return yield* new NotFoundError({ message: INSTALL_HINT })
          }),
        ),
      })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node],
  })
}
