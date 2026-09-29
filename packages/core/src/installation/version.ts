declare global {
  const CREWCODE_VERSION: string
  const CREWCODE_CHANNEL: string
}

export const InstallationVersion = typeof CREWCODE_VERSION === "string" ? CREWCODE_VERSION : "local"
export const InstallationChannel = typeof CREWCODE_CHANNEL === "string" ? CREWCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
