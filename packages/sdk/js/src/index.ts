export * from "./client.js"
export * from "./server.js"

import { createCrewcodeClient } from "./client.js"
import { createCrewcodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createCrewcode(options?: ServerOptions) {
  const server = await createCrewcodeServer({
    ...options,
  })

  const client = createCrewcodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
