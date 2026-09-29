import { AgentV2 } from "@crewcode/core/agent"
import { AISDK } from "@crewcode/core/aisdk"
import { Catalog } from "@crewcode/core/catalog"
import { CommandV2 } from "@crewcode/core/command"
import { Credential } from "@crewcode/core/credential"
import { AppNodeBuilder } from "@crewcode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@crewcode/core/effect/app-node-platform"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { EventV2 } from "@crewcode/core/event"
import { FileSystem } from "@crewcode/core/filesystem"
import { FSUtil } from "@crewcode/core/fs-util"
import { Integration } from "@crewcode/core/integration"
import { Location } from "@crewcode/core/location"
import { Npm } from "@crewcode/core/npm"
import { PluginV2 } from "@crewcode/core/plugin"
import { Reference } from "@crewcode/core/reference"
import { SkillV2 } from "@crewcode/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
