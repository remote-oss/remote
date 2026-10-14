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
