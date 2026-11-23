/**
 * @fileoverview The relay's store: one SQLite file (`node:sqlite`) holding the tunnels, each owned by a GitHub account's
 * numeric id, with their ports and their hosts' endpoints. A name is unique per owner and held in lower case; a rename
 * keeps the id. Fields the routes do not interpret are kept as the client sent them, as JSON.
 */

import {DatabaseSync} from 'node:sqlite';

/** A stored tunnel. */
export interface TunnelRecord {
  id: string;
  owner: number;
  /** The name in lower case, or the empty string for none. */
  name: string;
  fields: Record<string, unknown>;
}

/** A row of the store as SQLite gives it. */
interface Row {
  [column: string]: unknown;
}

/** The store over one SQLite file, or `:memory:`. */
export class Store {
  private readonly database: DatabaseSync;

  constructor(file: string) {
    this.database = new DatabaseSync(file);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tunnels (
        id TEXT PRIMARY KEY,
        owner INTEGER NOT NULL,
        name TEXT NOT NULL,
        fields TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS named ON tunnels (owner, name) WHERE name <> '';
      CREATE TABLE IF NOT EXISTS ports (
        tunnel TEXT NOT NULL REFERENCES tunnels (id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        fields TEXT NOT NULL,
        PRIMARY KEY (tunnel, number)
      );
      CREATE TABLE IF NOT EXISTS endpoints (
        tunnel TEXT NOT NULL REFERENCES tunnels (id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        fields TEXT NOT NULL,
        PRIMARY KEY (tunnel, endpoint)
      );
    `);
  }

  /** Runs `work` in one transaction, rolled back when it throws. */
  transaction<Result>(work: () => Result): Result {
    this.database.exec('BEGIN');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** Writes the tunnel, creating it or replacing its name and fields. */
  putTunnel(record: TunnelRecord): void {
    this.database
      .prepare(
        `INSERT INTO tunnels (id, owner, name, fields) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, fields = excluded.fields`,
      )
      .run(record.id, record.owner, record.name, JSON.stringify(record.fields));
  }

  /** The tunnel with id `id`, or none. */
  tunnelById(id: string): TunnelRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM tunnels WHERE id = ?')
      .get(id) as Row | undefined;
    return row === undefined ? undefined : tunnelOf(row);
  }

  /** The tunnel `owner` named `name` (in lower case), or none. */
  tunnelByName(owner: number, name: string): TunnelRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM tunnels WHERE owner = ? AND name = ? AND name <> ''",
      )
      .get(owner, name) as Row | undefined;
    return row === undefined ? undefined : tunnelOf(row);
  }

  /** Whether `owner` has another tunnel than `exceptId` named `name`. */
  nameTaken(owner: number, name: string, exceptId: string): boolean {
    const found = this.tunnelByName(owner, name);
    return found !== undefined && found.id !== exceptId;
  }

  /** The tunnels of `owner`, by id. */
  tunnelsOf(owner: number): TunnelRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM tunnels WHERE owner = ? ORDER BY id')
        .all(owner) as Row[]
    ).map(tunnelOf);
  }

  /** Deletes the tunnel with its ports and endpoints; whether there was one. */
  deleteTunnel(id: string): boolean {
    return (
      Number(
        this.database.prepare('DELETE FROM tunnels WHERE id = ?').run(id)
          .changes,
      ) > 0
    );
  }

  /** Writes port `number` of tunnel `tunnel`. */
  putPort(
    tunnel: string,
    number: number,
    fields: Record<string, unknown>,
  ): void {
    this.database
      .prepare(
        `INSERT INTO ports (tunnel, number, fields) VALUES (?, ?, ?)
         ON CONFLICT (tunnel, number) DO UPDATE SET fields = excluded.fields`,
      )
      .run(tunnel, number, JSON.stringify(fields));
  }

  /** Port `number` of tunnel `tunnel`, or none. */
  port(tunnel: string, number: number): Record<string, unknown> | undefined {
    const row = this.database
      .prepare('SELECT fields FROM ports WHERE tunnel = ? AND number = ?')
      .get(tunnel, number) as Row | undefined;
    return row === undefined ? undefined : fieldsOf(row);
  }

  /** The ports of tunnel `tunnel`, by number. */
  portsOf(tunnel: string): Array<Record<string, unknown>> {
    return (
      this.database
        .prepare('SELECT fields FROM ports WHERE tunnel = ? ORDER BY number')
        .all(tunnel) as Row[]
    ).map(fieldsOf);
  }

  /** Deletes port `number` of tunnel `tunnel`; whether there was one. */
  deletePort(tunnel: string, number: number): boolean {
    return (
      Number(
        this.database
          .prepare('DELETE FROM ports WHERE tunnel = ? AND number = ?')
          .run(tunnel, number).changes,
      ) > 0
    );
  }

  /** Writes endpoint `endpoint` of tunnel `tunnel`. */
  putEndpoint(
    tunnel: string,
    endpoint: string,
    fields: Record<string, unknown>,
  ): void {
    this.database
      .prepare(
        `INSERT INTO endpoints (tunnel, endpoint, fields) VALUES (?, ?, ?)
         ON CONFLICT (tunnel, endpoint) DO UPDATE SET fields = excluded.fields`,
      )
      .run(tunnel, endpoint, JSON.stringify(fields));
  }

  /** The endpoints of tunnel `tunnel`, by id. */
  endpointsOf(tunnel: string): Array<Record<string, unknown>> {
    return (
      this.database
        .prepare(
          'SELECT fields FROM endpoints WHERE tunnel = ? ORDER BY endpoint',
        )
        .all(tunnel) as Row[]
    ).map(fieldsOf);
  }

  /** Deletes endpoint `endpoint` of tunnel `tunnel`; whether there was one. */
  deleteEndpoint(tunnel: string, endpoint: string): boolean {
    return (
      Number(
        this.database
          .prepare('DELETE FROM endpoints WHERE tunnel = ? AND endpoint = ?')
          .run(tunnel, endpoint).changes,
      ) > 0
    );
  }

  close(): void {
    this.database.close();
  }
}

function tunnelOf(row: Row): TunnelRecord {
  return {
    id: String(row.id),
    owner: Number(row.owner),
    name: String(row.name),
    fields: fieldsOf(row),
  };
}

function fieldsOf(row: Row): Record<string, unknown> {
  return JSON.parse(String(row.fields)) as Record<string, unknown>;
}
