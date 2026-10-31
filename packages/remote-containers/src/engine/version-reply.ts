/** The oldest engine API the checks accept, as major and minor. */
const MINIMUM_API: readonly [number, number] = [1, 35];

/**
 * The API version the engine reports in the reply of `docker version --format '{{json .}}'`: `Server.ApiVersion`,
 * when it has the form `<digits>.<digits>`. The client's version and both product versions are never read.
 */
export function serverApiOf(stdout: string): string | undefined {
  let reply: unknown;
  try {
    reply = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const server = (reply as {Server?: {ApiVersion?: unknown} | null} | null)
    ?.Server;
  const reported = server?.ApiVersion;
  return typeof reported === 'string' && /^\d+\.\d+$/.test(reported)
    ? reported
    : undefined;
}

/**
 * Whether a reply that parses as a JSON object has no `Server` member at all, as the reply of an engine that has no
 * server to name does (Podman's `podman version`): the API check then has nothing to check. A reply with a `Server`,
 * whatever its API version, and text that is no JSON object are not this case.
 */
export function apiCheckSkipped(stdout: string): boolean {
  try {
    const reply: unknown = JSON.parse(stdout);
    return (
      typeof reply === 'object' &&
      reply !== null &&
      !Array.isArray(reply) &&
      !('Server' in reply)
    );
  } catch {
    return false;
  }
}

/** Whether an API version is known and older than the minimum, compared as numbers. */
export function isBelowMinimum(apiVersion: string | undefined): boolean {
  if (apiVersion === undefined) {
    return false;
  }
  const [major = 0, minor = 0] = apiVersion.split('.').map(Number);
  const [minimumMajor, minimumMinor] = MINIMUM_API;
  return (
    major < minimumMajor || (major === minimumMajor && minor < minimumMinor)
  );
}
