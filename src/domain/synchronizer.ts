import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import type { CaptureStore } from "../storage/database";
import type { LocalCapture } from "./types";
export class Synchronizer {
  private busy = false;
  constructor(
    private api: ApiClient,
    private store: CaptureStore,
  ) {}
  async flush(c: LocalCapture) {
    if (
      this.busy ||
      !this.api.token ||
      this.api.owner !== c.owner ||
      this.api.base !== c.server
    )
      return;
    this.busy = true;
    try {
      for (let page = 0; page < 16; page++) {
        const jobs = await this.store.pending(c);
        if (!jobs.length) break;
        const batch = jobs[0];
        try {
          const body = JSON.parse(batch.payload);
          const ack = await this.api.post(
            `/mobile/devices/${encodeURIComponent(batch.uid)}/streams/${batch.stream_id}/batches`,
            body,
          );
          if (
            ack.committed !== true ||
            ack.client_batch_id !== batch.id ||
            ack.accepted !== body.frames.length
          )
            throw new Error("INVALID_COMMIT_ACK");
          await this.store.ack(batch.id);
        } catch (error) {
          const e = error as Error;
          const retryable =
            !(e instanceof ApiError) ||
            [401, 408, 429].includes(e.status) ||
            e.status >= 500;
          await this.store.retry(
            batch,
            e.message,
            retryable,
            error instanceof ApiError ? error.retryAfter : 0,
          );
          throw error;
        }
      }
      const counts = await this.store.counts(c);
      if (
        c.state !== "recording" &&
        c.state !== "interrupted" &&
        !counts.pending
      ) {
        for (const s of c.streams) {
          if (s.last !== undefined && s.last >= s.first && !s.closed) {
            await this.api.post(
              `/mobile/devices/${encodeURIComponent(s.uid)}/streams/${s.streamId}/close`,
              { expected_last_sequence: s.last },
            );
            s.closed = true;
            await this.store.saveCapture(c);
          }
        }
        await this.api.post(`/sessions/${c.id}/stop`);
        c.state = "synced";
        await this.store.saveCapture(c);
      }
    } finally {
      this.busy = false;
    }
  }
}
