import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerCrewcodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
