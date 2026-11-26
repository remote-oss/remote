import {deepStrictEqual} from 'node:assert';
import {auditScript, outboundConnectionsOf} from './connection-audit.ts';

/** An event's row as the script prints it. */
function printed(
  processId: number,
  direction: string,
  address: string,
  port: number,
) {
  return {
    ProcessID: String(processId),
    Direction: direction,
    DestAddress: address,
    DestPort: String(port),
  };
}

describe('the connection audit (card #3141)', () => {
  it('lists the outbound connections of the process asked for, in order, and no inbound one and none of another process', () => {
    const text = JSON.stringify([
      printed(100, '%%14593', '10.0.0.5', 443),
      printed(100, '%%14592', '10.0.0.6', 80),
      printed(200, '%%14593', '10.0.0.7', 443),
      printed(100, '%%14593', '172.17.0.1', 8080),
    ]);
    deepStrictEqual(outboundConnectionsOf(text, 100), [
      {processId: 100, address: '10.0.0.5', port: 443},
      {processId: 100, address: '172.17.0.1', port: 8080},
    ]);
  });

  it('reads a single event, which PowerShell prints as an object and not an array, numbers given as numbers, and no events as none', () => {
    deepStrictEqual(
      [
        outboundConnectionsOf(
          JSON.stringify({
            ProcessID: 100,
            Direction: '%%14593',
            DestAddress: '::1',
            DestPort: 22,
          }),
          100,
        ),
        outboundConnectionsOf('[]', 100),
        outboundConnectionsOf('  \r\n', 100),
      ],
      [[{processId: 100, address: '::1', port: 22}], [], []],
    );
  });

  it('asks the Security log for events 5156 from the start time on, and prints JSON', () => {
    const script = auditScript(new Date('2026-11-26T07:30:00.000Z'));
    deepStrictEqual(
      [
        script.includes("[DateTime]::Parse('2026-11-26T07:30:00.000Z')"),
        script.includes('Id=5156'),
        script.includes('ConvertTo-Json -InputObject $rows'),
      ],
      [true, true, true],
    );
  });
});
