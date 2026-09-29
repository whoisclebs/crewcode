/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeCrewcodeContent from "./skill/customize-crewcode.md" with { type: "text" }

export const CustomizeCrewcodeContent = customizeCrewcodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-crewcode",
            description:
              "Use ONLY when the user is editing or creating crewcode's own configuration: crewcode.json, crewcode.jsonc, files under .crewcode/, or files under ~/.config/crewcode/. Also use when creating or fixing crewcode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring crewcode itself.",
            location: AbsolutePath.make("/builtin/customize-crewcode.md"),
            content: CustomizeCrewcodeContent,
          }),
        }),
      )
    })
  }),
})
