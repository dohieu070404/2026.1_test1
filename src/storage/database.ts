import { openCaptureDatabase, type SqlConnection } from "./sqlite";
import { v5 as uuidv5 } from "uuid";
import type { LocalCapture, SensorFrame } from "../domain/types";
const NS = "362c3a6e-7774-4d35-91e0-a25f3f931a58";
export type PendingBatch = {
  id: string;
  session_id: string;
  uid: string;
  stream_id: string;
  payload: string;
  error: string | null;
  attempts: number;
  next_at: number;
};
export class CaptureStore {
  private db!: SqlConnection;
  private bytes = 0;
  async open() {
    this.db = await openCaptureDatabase();
    await this.db.executeSql("PRAGMA journal_mode=WAL");
    await this.db.executeSql("PRAGMA synchronous=FULL");
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,owner TEXT NOT NULL,server TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL)",
    );
    await this.db.executeSql(
      `CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,uid TEXT NOT NULL,stream_id TEXT NOT NULL,payload TEXT NOT NULL,synced INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT)`,
    );
    await this.db.executeSql(
      "CREATE INDEX IF NOT EXISTS batches_pending ON batches(synced,next_at)",
    );
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS upload_jobs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,uid TEXT NOT NULL,stream_id TEXT NOT NULL,payload TEXT NOT NULL,items TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT)",
    );
    const [size] = await this.db.executeSql(
      "SELECT COALESCE(SUM(LENGTH(payload)),0) bytes FROM batches",
    );
    this.bytes = Number(size.rows.item(0).bytes);
  }
  async setting(key: string, fallback = "") {
    const [r] = await this.db.executeSql(
      "SELECT value FROM settings WHERE key=?",
      [key],
    );
    return r.rows.length ? r.rows.item(0).value : fallback;
  }
  async setSetting(key: string, value: string) {
    await this.db.executeSql(
      "INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)",
      [key, value],
    );
  }
  async saveCapture(c: LocalCapture) {
    await this.db.executeSql(
      "INSERT OR REPLACE INTO captures(id,owner,server,state,data) VALUES (?,?,?,?,?)",
      [c.id, c.owner, c.server, c.state, JSON.stringify(c)],
    );
  }
  async captures(owner: string, server: string): Promise<LocalCapture[]> {
    const [r] = await this.db.executeSql(
      "SELECT data FROM captures WHERE owner=? AND server=? ORDER BY rowid DESC",
      [owner, server],
    );
    return r.rows.raw().map((x: any) => JSON.parse(x.data));
  }
  async record(
    c: LocalCapture,
    uid: string,
    boot: string,
    streamId: string,
    frames: SensorFrame[],
  ) {
    const id = uuidv5(
      `${c.id}:${uid}:${boot}:${frames[0].sequence_no}:${frames.at(-1)!.sequence_no}`,
      NS,
    );
    const payload = JSON.stringify({ client_batch_id: id, frames });
    const [old] = await this.db.executeSql(
      "SELECT payload FROM batches WHERE id=?",
      [id],
    );
    if (old.rows.length) {
      if (old.rows.item(0).payload !== payload)
        throw new Error("LOCAL_BATCH_CONTENT_CONFLICT");
      return;
    }
    if (this.bytes + payload.length > 128 * 1024 * 1024)
      throw new Error("LOCAL_STORAGE_FULL_EXPORT_BEFORE_RECORDING");
    // Promise resolves after SQLite autocommit; only then can BLE ACK release the device ring.
    await this.db.executeSql(
      "INSERT INTO batches(id,session_id,uid,stream_id,payload) VALUES (?,?,?,?,?)",
      [id, c.id, uid, streamId, payload],
    );
    this.bytes += payload.length;
  }
  async pending(c: LocalCapture): Promise<PendingBatch[]> {
    const [existing] = await this.db.executeSql(
      "SELECT * FROM upload_jobs WHERE session_id=? ORDER BY rowid LIMIT 1",
      [c.id],
    );
    if (existing.rows.length) {
      const job = existing.rows.item(0);
      return job.error || job.next_at > Date.now() ? [] : [job];
    }
    const [rows] = await this.db.executeSql(
      "SELECT * FROM batches WHERE session_id=? AND synced=0 ORDER BY rowid LIMIT 1",
      [c.id],
    );
    if (!rows.rows.length) return [];
    const first = rows.rows.item(0);
    const [group] = await this.db.executeSql(
      "SELECT * FROM batches WHERE session_id=? AND uid=? AND stream_id=? AND synced=0 ORDER BY rowid LIMIT 30",
      [c.id, first.uid, first.stream_id],
    );
    const members = group.rows.raw();
    const frames = members.flatMap((b: any) => JSON.parse(b.payload).frames);
    const id = uuidv5(members.map((b: any) => b.id).join(":"), NS);
    const payload = JSON.stringify({ client_batch_id: id, frames });
    await this.db.executeSql(
      "INSERT INTO upload_jobs(id,session_id,uid,stream_id,payload,items) VALUES (?,?,?,?,?,?)",
      [
        id,
        c.id,
        first.uid,
        first.stream_id,
        payload,
        JSON.stringify(members.map((b: any) => b.id)),
      ],
    );
    return [
      {
        id,
        session_id: c.id,
        uid: first.uid,
        stream_id: first.stream_id,
        payload,
        attempts: 0,
        next_at: 0,
        error: null,
      },
    ];
  }
  async counts(c: LocalCapture) {
    const [r] = await this.db.executeSql(
      "SELECT COUNT(*) total,COALESCE(SUM(synced=0),0) pending,(SELECT COUNT(*) FROM upload_jobs WHERE session_id=? AND error IS NOT NULL) blocked FROM batches WHERE session_id=?",
      [c.id, c.id],
    );
    return r.rows.item(0) as {
      total: number;
      pending: number;
      blocked: number;
    };
  }
  async ack(id: string) {
    const [job] = await this.db.executeSql(
      "SELECT items FROM upload_jobs WHERE id=?",
      [id],
    );
    if (!job.rows.length) throw new Error("UPLOAD_JOB_MISSING");
    const ids: string[] = JSON.parse(job.rows.item(0).items);
    // Two durable statements: redoing the first after a crash is harmless.
    await this.db.executeSql(
      `UPDATE batches SET synced=1,error=NULL WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    await this.db.executeSql("DELETE FROM upload_jobs WHERE id=?", [id]);
  }
  async retry(
    b: PendingBatch,
    error: string,
    retryable: boolean,
    retryAfter = 0,
  ) {
    const delay =
      Math.max(
        retryAfter * 1000,
        Math.min(30000, 1000 * 2 ** Math.min(b.attempts, 5)),
      ) + Math.floor(Math.random() * 250);
    await this.db.executeSql(
      "UPDATE upload_jobs SET attempts=attempts+1,next_at=?,error=? WHERE id=?",
      [Date.now() + delay, retryable ? null : error, b.id],
    );
  }
  async retryBlocked(c: LocalCapture) {
    await this.db.executeSql(
      "UPDATE upload_jobs SET error=NULL,next_at=0 WHERE session_id=?",
      [c.id],
    );
  }
  async archive(c: LocalCapture) {
    const [r] = await this.db.executeSql(
      "SELECT payload FROM batches WHERE session_id=? ORDER BY rowid",
      [c.id],
    );
    return r.rows.raw().map((x: any) => JSON.parse(x.payload));
  }
  async removeSynced(c: LocalCapture) {
    if (c.state !== "synced") throw new Error("CAPTURE_NOT_SYNCED");
    const [size] = await this.db.executeSql(
      "SELECT COALESCE(SUM(LENGTH(payload)),0) bytes FROM batches WHERE session_id=? AND synced=1",
      [c.id],
    );
    await this.db.executeSql(
      "DELETE FROM batches WHERE session_id=? AND synced=1",
      [c.id],
    );
    this.bytes = Math.max(0, this.bytes - Number(size.rows.item(0).bytes));
    await this.db.executeSql("DELETE FROM captures WHERE id=?", [c.id]);
  }
}
