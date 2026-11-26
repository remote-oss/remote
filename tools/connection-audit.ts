/**
 * @fileoverview The connections a Windows process made, from the Security log's events 5156 ("the Windows Filtering
 * Platform has permitted a connection"), which the platform workflow's Windows job turns on with `auditpol`. The rows
 * of the acceptance suites read them to show that a process contacted nothing but the hosts it may.
 */

/** One permitted connection as an event 5156 records it, as far as the rows read it. */
export interface Connection {
  processId: number;
  address: string;
  port: number;
}

/** The value of an event's `Direction` field for an outbound connection. */
const OUTBOUND = '%%14593';

/**
 * The PowerShell that prints the permitted connections since `since` as a JSON array of objects with `ProcessID`,
 * `Direction`, `DestAddress` and `DestPort`, none as `[]`.
 */
export function auditScript(since: Date): string {
  return [
    `$since = [DateTime]::Parse('${since.toISOString()}').ToUniversalTime()`,
    "$rows = @(Get-WinEvent -FilterHashtable @{LogName='Security'; Id=5156; StartTime=$since} -ErrorAction SilentlyContinue | ForEach-Object {",
    '  $data = @{}',
    "  ([xml]$_.ToXml()).Event.EventData.Data | ForEach-Object { $data[$_.Name] = $_.'#text' }",
    '  [pscustomobject]@{ProcessID=$data.ProcessID; Direction=$data.Direction; DestAddress=$data.DestAddress; DestPort=$data.DestPort}',
    '})',
    'ConvertTo-Json -InputObject $rows -Compress',
  ].join('\n');
}

/** What the script printed for one event, its numbers as the event's text has them. */
interface Row {
  ProcessID: string | number;
  Direction: string;
  DestAddress: string;
  DestPort: string | number;
}

/** The outbound connections of process `processId` that the script's output `text` lists, in its order. */
export function outboundConnectionsOf(
  text: string,
  processId: number,
): Connection[] {
  const rows = JSON.parse(text.trim() === '' ? '[]' : text) as Row | Row[];
  return (Array.isArray(rows) ? rows : [rows])
    .filter(
      event =>
        Number(event.ProcessID) === processId && event.Direction === OUTBOUND,
    )
    .map(event => ({
      processId,
      address: event.DestAddress,
      port: Number(event.DestPort),
    }));
}
