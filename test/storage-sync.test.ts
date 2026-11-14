import { CaptureStore } from "../src/storage/database";
import { Synchronizer } from "../src/domain/synchronizer";
import { ApiClient, ApiError } from "../src/api/client";
import type { LocalCapture, SensorFrame } from "../src/domain/types";
const capture = (): LocalCapture => ({
  id: "00000000-0000-4000-8000-000000000001",
  owner: "owner",
  server: "https://example.com/api/v1",
  state: "recording",
  streams: [
    {
      uid: "ESP-L",
      side: "left",
      bleId: "aa",
      bootId: "boot",
      streamId: "1",
      first: 0,
    },
  ],
  startedAt: 0,
});
const frame = (seq: number): SensorFrame => ({
  sequence_no: seq,
  device_time_us: seq * 10000,
  fsr: Array(8).fill(seq),
  fsr_filtered: Array(8).fill(seq),
  filter_version: "ema10-exp-v1",
  fsr_valid_mask: 255,
  quality_flags: 1,
  imu: null,
});
test("durably retains a packet once, rejects conflicting content, and groups up to 90 frames in one stable upload", async () => {
  const store = new CaptureStore();
  await store.open();
  const c = capture();
  await store.saveCapture(c);
  for (let i = 0; i < 90; i += 3)
    await store.record(c, "ESP-L", "boot", "1", [
      frame(i),
      frame(i + 1),
      frame(i + 2),
    ]);
  await store.record(c, "ESP-L", "boot", "1", [frame(0), frame(1), frame(2)]);
  expect(await store.counts(c)).toMatchObject({ total: 30, pending: 30 });
  const bad = frame(0);
  bad.fsr[0] = 7;
  await expect(
    store.record(c, "ESP-L", "boot", "1", [bad, frame(1), frame(2)]),
  ).rejects.toThrow("LOCAL_BATCH_CONTENT_CONFLICT");
  const [job] = await store.pending(c);
  expect(JSON.parse(job.payload).frames).toHaveLength(90);
  expect((await store.pending(c))[0]).toMatchObject(job);
  await store.ack(job.id);
  expect(await store.counts(c)).toMatchObject({ pending: 0 });
});
test("retries identical payload after a lost response, only closes after a matching committed ACK", async () => {
  const store = new CaptureStore();
  await store.open();
  const c = capture();
  c.state = "stopped";
  c.streams[0].last = 2;
  await store.saveCapture(c);
  await store.record(c, "ESP-L", "boot", "1", [frame(0), frame(1), frame(2)]);
  const api = new ApiClient();
  Object.assign(api, { base: c.server, owner: c.owner, token: "token" });
  const bodies: unknown[] = [];
  api.post = jest.fn(async (path, body: any) => {
    if (path.endsWith("/batches")) {
      bodies.push(body);
      if (bodies.length === 1) throw new ApiError(503, "LOST_RESPONSE");
      return {
        committed: true,
        client_batch_id: body.client_batch_id,
        accepted: body.frames.length,
      };
    }
    return { committed: true };
  }) as any;
  const sync = new Synchronizer(api, store);
  await expect(sync.flush(c)).rejects.toThrow("LOST_RESPONSE");
  expect(c.state).toBe("stopped");
  await store.retryBlocked(c);
  await sync.flush(c);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(c.state).toBe("synced");
  expect(c.streams[0].closed).toBe(true);
  expect(await store.counts(c)).toMatchObject({ pending: 0 });
});
test("blocks 409 conflicts and rejects an invalid ACK without deleting data", async () => {
  const store = new CaptureStore();
  await store.open();
  const c = capture();
  await store.record(c, "ESP-L", "boot", "1", [frame(0)]);
  const api = new ApiClient();
  Object.assign(api, { base: c.server, owner: c.owner, token: "token" });
  api.post = jest.fn(async () => {
    throw new ApiError(409, "CONFLICT");
  }) as any;
  const sync = new Synchronizer(api, store);
  await expect(sync.flush(c)).rejects.toThrow("CONFLICT");
  expect(await store.pending(c)).toHaveLength(0);
  expect(await store.counts(c)).toMatchObject({ pending: 1, blocked: 1 });
  await store.retryBlocked(c);
  api.post = jest.fn(async () => ({
    committed: true,
    client_batch_id: "wrong",
    accepted: 1,
  })) as any;
  await expect(sync.flush(c)).rejects.toThrow("INVALID_COMMIT_ACK");
  expect(await store.counts(c)).toMatchObject({ pending: 1 });
});
test("never uploads another account or server capture", async () => {
  const store = new CaptureStore();
  await store.open();
  const api = new ApiClient();
  Object.assign(api, { owner: "different", base: "other", token: "x" });
  api.post = jest.fn();
  await new Synchronizer(api, store).flush(capture());
  expect(api.post).not.toHaveBeenCalled();
});

test("an interrupted capture uploads saved packets but waits for recovery before automatic close", async () => {
  const store = new CaptureStore();
  await store.open();
  const c = capture();
  c.state = "interrupted";
  await store.saveCapture(c);
  await store.record(c, "ESP-L", "boot", "1", [frame(0)]);
  const api = new ApiClient();
  Object.assign(api, { base: c.server, owner: c.owner, token: "token" });
  api.post = jest.fn(async (path, body: any) => ({
    committed: true,
    client_batch_id: body.client_batch_id,
    accepted: body.frames.length,
  })) as any;
  await new Synchronizer(api, store).flush(c);
  expect(c.state).toBe("interrupted");
  expect(
    (api.post as jest.Mock).mock.calls.every(([path]) =>
      path.endsWith("/batches"),
    ),
  ).toBe(true);
});
