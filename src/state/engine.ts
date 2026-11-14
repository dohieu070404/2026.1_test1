import { ApiClient, isDebugBuild } from "../api/client";
import { CaptureStore } from "../storage/database";
import { BleTransport, type BleLink } from "../transport/ble";
import { SequenceTracker } from "../domain/protocol";
import { Synchronizer } from "../domain/synchronizer";
import type {
  LocalCapture,
  Pair,
  SensorFrame,
  SensorView,
  Side,
} from "../domain/types";
const empty = (): SensorView => ({
  raw: Array(8).fill(0),
  filtered: Array(8).fill(0),
  mask: 0,
  flags: 0,
  trace: [],
  count: 0,
  gaps: 0,
  duplicates: 0,
  time: 0,
});
export class AppEngine {
  api = new ApiClient();
  store = new CaptureStore();
  ble = new BleTransport();
  sync = new Synchronizer(this.api, this.store);
  capture: LocalCapture | null = null;
  views: Record<Side, SensorView> = { left: empty(), right: empty() };
  remoteSession: string | null = null;
  private remoteTimer?: ReturnType<typeof setInterval>;
  simulation = false;
  simStarted = 0;
  error = "";
  syncing = false;
  private simulationTimer?: ReturnType<typeof setInterval>;
  private syncTimer?: ReturnType<typeof setInterval>;
  private listeners = new Set<() => void>();
  private uiTimer?: ReturnType<typeof setInterval>;
  private dirty = false;
  private stopping = false;
  private starting = false;
  private inForeground = true;
  private generation = 0;
  private trackers = new Map<string, SequenceTracker>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  changed = () => {
    for (const fn of this.listeners) fn();
  };
  async initialize() {
    const generation = ++this.generation;
    if (this.uiTimer) clearInterval(this.uiTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    await this.store.open();
    const base = await this.store.setting(
      "server",
      process.env.EXPO_PUBLIC_API_URL ||
        (isDebugBuild
          ? "http://10.0.2.2:8081/api/v1"
          : "https://example.invalid/api/v1"),
    );
    await this.api.configure(base);
    if (generation !== this.generation) return;
    this.uiTimer = setInterval(() => {
      if (this.dirty) {
        this.dirty = false;
        this.changed();
      }
    }, 100);
    this.syncTimer = setInterval(() => {
      void this.flush();
    }, 3000);
  }
  async dispose() {
    ++this.generation;
    if (this.uiTimer) clearInterval(this.uiTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.uiTimer = undefined;
    this.syncTimer = undefined;
    this.listeners.clear();
    this.stopRemote();
    this.stopSimulation();
    try {
      if (this.capture?.state === "recording") await this.stop();
    } finally {
      await this.ble.disconnectAll();
    }
  }
  async signedIn() {
    const me = await this.api.request("/me");
    this.api.owner = me.public_id;
    const stored = await this.store.captures(me.public_id, this.api.base);
    for (const c of stored)
      if (c.state === "recording") {
        c.state = "interrupted";
        c.error = "Ứng dụng bị dừng; chưa biết mẫu cuối trên thiết bị.";
        await this.store.saveCapture(c);
      }
    void this.flush();
    return me;
  }
  async flush() {
    if (this.syncing || !this.api.owner || this.simulation) return;
    this.syncing = true;
    try {
      const stored = await this.store.captures(this.api.owner, this.api.base);
      for (const c of stored) {
        if (c.state === "synced") continue;
        const current = this.capture?.id === c.id ? this.capture : c;
        await this.sync.flush(current);
      }
      this.error = "";
    } catch (e) {
      this.error = String(e);
    } finally {
      this.syncing = false;
      this.changed();
    }
  }
  private async attach(
    link: BleLink,
    c: LocalCapture,
    stream: LocalCapture["streams"][number],
  ) {
    const tracker = new SequenceTracker();
    tracker.last = stream.first - 1;
    this.trackers.set(stream.uid, tracker);
    link.onFrames = async (frames) => {
      if (this.capture?.id !== c.id)
        throw new Error("CAPTURE_SESSION_MISMATCH");
      await this.store.record(
        c,
        stream.uid,
        stream.bootId,
        stream.streamId,
        frames,
      );
      const fresh = tracker.observe(frames);
      if (fresh.length) this.updateView(stream.side, fresh, tracker);
    };
    link.onState = () => {
      if (
        link.state === "ERROR" &&
        c.state === "recording" &&
        (!link.reconnecting ||
          /BLE_PACKET|LOCAL_|BLE_SAMPLE|BLE_INTEGER|BLE_CLOCK|BOOT_OR_SESSION/.test(
            link.error,
          ))
      ) {
        c.error = link.error;
        void this.stop().catch((e) => {
          this.error = String(e);
          this.changed();
        });
      }
      this.changed();
    };
    link.onReconnect = async () => {
      const info = await link.readIdentity();
      // Never splice a reboot or a different session into an existing stream.
      if (info.boot_id !== stream.bootId || info.session_id !== c.id)
        throw new Error("BOOT_OR_SESSION_CHANGED_STOP_AND_START_NEW");
      if (c.state !== "recording") return;
      const ticket = await this.api.post(
        `/mobile/devices/${encodeURIComponent(stream.uid)}/authorize`,
        { session_id: c.id, boot_id: stream.bootId, nonce: info.nonce },
      );
      await link.command(ticket);
      const confirmed = await link.waitForIdentity(
        (x) => x.recording && x.session_id === c.id && !!x.receipt,
      );
      await this.api.post(
        `/mobile/devices/${encodeURIComponent(stream.uid)}/verify`,
        {
          session_id: c.id,
          boot_id: confirmed.boot_id,
          nonce: ticket.n,
          receipt: confirmed.receipt,
          first: confirmed.first_sequence,
        },
      );
      link.streaming();
    };
  }
  private updateView(
    side: Side,
    frames: SensorFrame[],
    tracker?: SequenceTracker,
  ) {
    const view = this.views[side];
    const latest = frames.at(-1)!;
    view.raw = latest.fsr;
    view.filtered = latest.fsr_filtered;
    view.mask = latest.fsr_valid_mask;
    view.flags = latest.quality_flags;
    view.count += frames.length;
    view.time = latest.device_time_us;
    for (const frame of frames)
      view.trace.push({
        raw: frame.fsr[0],
        filtered: frame.fsr_filtered[0],
        channels: frame.fsr,
        filteredChannels: frame.fsr_filtered,
      });
    if (view.trace.length > 200) view.trace.splice(0, view.trace.length - 200);
    view.gaps = tracker?.gaps ?? 0;
    view.duplicates = tracker?.duplicates ?? 0;
    this.dirty = true;
  }
  async watchRemote(id: string) {
    if (this.capture?.state === "recording" || this.simulation)
      throw new Error("Một phiên khác đang đo.");
    this.stopRemote();
    this.remoteSession = id;
    const update = async () => {
      if (this.remoteSession !== id) return;
      try {
        const session = await this.api.request(`/sessions/${id}`);
        if (this.remoteSession !== id) return;
        for (const stream of session.streams || []) {
          if (!stream.latest) continue;
          const view = this.views[stream.side as Side],
            latest = stream.latest;
          const raw = Array.from({ length: 8 }, (_, k) =>
            Number(latest[`fsr_${k + 1}`]),
          );
          view.raw = raw;
          view.filtered = Array(8).fill(null);
          view.mask = latest.fsr_valid_mask;
          view.flags = latest.quality_flags;
          view.time = Number(latest.device_time_us);
          view.count = Number(
            stream.frame_count || stream.received_frames || 0,
          );
          const plot = await this.api.request(
            `/streams/${stream.id}/plot?points=150&window_seconds=10`,
          );
          if (this.remoteSession !== id) return;
          view.trace = plot.frames.map((f: any) => ({
            raw: Number(f.fsr_1),
            filtered: null,
            channels: Array.from({ length: 8 }, (_, k) =>
              Number(f[`fsr_${k + 1}`]),
            ),
          }));
        }
        this.changed();
      } catch (e) {
        this.error = String(e);
        this.changed();
      }
    };
    await update();
    this.remoteTimer = setInterval(() => {
      void update();
    }, 2000);
  }
  stopRemote() {
    if (this.remoteTimer) clearInterval(this.remoteTimer);
    this.remoteSession = null;
  }
  async start(pair: Pair, activity: string, notes: string) {
    if (this.starting) throw new Error("Đang chuẩn bị một phiên đo.");
    if (!this.inForeground)
      throw new Error("Hãy mở ứng dụng trước khi bắt đầu đo.");
    this.starting = true;
    try {
      await this.startCapture(pair, activity, notes);
    } finally {
      this.starting = false;
      if (!this.inForeground) await this.stop();
    }
  }
  private async startCapture(pair: Pair, activity: string, notes: string) {
    this.stopRemote();
    if (this.simulation || this.capture?.state === "recording")
      throw new Error("Một phiên khác đang đo.");
    const links: BleLink[] = [];
    for (const device of pair.devices) {
      const link = [...this.ble.links.values()].find(
        (l) =>
          l.identity?.device_uid === device.device_uid &&
          l.state === "CONNECTED",
      );
      if (!link || link.identity?.side !== device.side)
        throw new Error(
          "Hãy kết nối đúng hai lót trái và phải của cặp đã chọn.",
        );
      links.push(link);
    }
    if (
      links.length !== 2 ||
      new Set(links.map((l) => l.identity!.side)).size !== 2
    )
      throw new Error("Cần đủ hai bên.");
    const created = await this.api.post("/sessions", {
      pair_uid: pair.pair_uid,
      transport: "ble",
      activity,
      notes,
      target_sample_rate_hz: 100,
    });
    const c: LocalCapture = {
      id: created.session_id,
      owner: this.api.owner,
      server: this.api.base,
      state: "recording",
      streams: [],
      startedAt: Date.now(),
    };
    this.capture = c;
    this.views = { left: empty(), right: empty() };
    try {
      await this.store.saveCapture(c);
      await this.api.post(`/sessions/${c.id}/start`);
      const tickets: { link: BleLink; ticket: unknown }[] = [];
      for (const link of links) {
        const info = await link.readIdentity();
        if (info.pending > 0 || info.recording)
          throw new Error(
            "Thiết bị còn dữ liệu phiên cũ. Cần khôi phục trước.",
          );
        const result = await this.api.post(
          `/mobile/devices/${encodeURIComponent(info.device_uid)}/sessions/${c.id}/streams`,
          {
            device_uid: info.device_uid,
            side: info.side,
            boot_id: info.boot_id,
            sample_rate_hz: 100,
            expected_first_sequence: info.next_sequence,
          },
        );
        const stream = {
          uid: info.device_uid,
          side: info.side,
          bleId: link.id,
          bootId: info.boot_id,
          streamId: String(result.stream_id),
          first: info.next_sequence,
        };
        c.streams.push(stream);
        await this.store.saveCapture(c);
        await this.attach(link, c, stream);
        const ticket = await this.api.post(
          `/mobile/devices/${encodeURIComponent(info.device_uid)}/authorize`,
          { session_id: c.id, boot_id: info.boot_id, nonce: info.nonce },
        );
        tickets.push({ link, ticket });
      }
      if (!this.inForeground)
        throw new Error("Ứng dụng đã chuyển nền trong lúc chuẩn bị.");
      for (const { link, ticket } of tickets) {
        await link.command(ticket);
        const info = await link.waitForIdentity(
          (candidate) =>
            candidate.recording &&
            candidate.session_id === c.id &&
            !!candidate.receipt,
        );
        await this.api.post(
          `/mobile/devices/${encodeURIComponent(info.device_uid)}/verify`,
          {
            session_id: c.id,
            boot_id: info.boot_id,
            nonce: (ticket as any).n,
            receipt: info.receipt,
            first: info.first_sequence,
          },
        );
        if (!info.recording || info.session_id !== c.id)
          throw new Error("ESP32 từ chối lệnh bắt đầu.");
        link.streaming();
      }
    } catch (e) {
      c.error = String(e);
      await this.stop();
      throw e;
    }
    this.changed();
  }
  async stop() {
    if (this.simulation) {
      this.stopSimulation();
      return;
    }
    const c = this.capture;
    if (!c || c.state !== "recording" || this.stopping) return;
    this.stopping = true;
    try {
      // STOP both before draining either, keeping the end window short.
      await Promise.all(
        c.streams.map((s) =>
          this.ble.links
            .get(s.bleId)
            ?.command({ op: "stop" })
            .catch(() => {}),
        ),
      );
      for (const stream of c.streams) {
        const link = this.ble.links.get(stream.bleId);
        try {
          if (!link?.device)
            throw new Error("Thiết bị mất kết nối; chưa biết mẫu cuối.");
          const info = await link.drain();
          if (info.boot_id !== stream.bootId || info.session_id !== c.id)
            throw new Error("Thiết bị đã đổi boot hoặc phiên.");
          if (info.next_sequence > stream.first)
            stream.last = info.last_sequence;
        } catch (e) {
          c.error = String(e);
        }
        if (link) {
          link.onFrames = null;
          link.onReconnect = null;
          await link.disconnect();
        }
      }
      c.state = c.error ? "interrupted" : "stopped";
      await this.store.saveCapture(c);
      this.changed();
      void this.flush();
    } finally {
      this.stopping = false;
    }
  }
  async recover(c: LocalCapture) {
    if (this.capture?.state === "recording")
      throw new Error("Hãy kết thúc phiên đang đo.");
    if (c.server !== this.api.base || c.owner !== this.api.owner)
      throw new Error("CAPTURE_OWNER_MISMATCH");
    this.capture = c;
    for (const s of c.streams) {
      const link = await this.ble.connect(s.bleId);
      const info = await link.readIdentity();
      if (info.boot_id !== s.bootId || info.session_id !== c.id)
        throw new Error(
          "Không còn bộ đệm của phiên trên thiết bị; đuôi mẫu vẫn chưa xác định.",
        );
      await this.attach(link, c, s);
      const ticket = await this.api.post(
        `/mobile/devices/${encodeURIComponent(s.uid)}/authorize`,
        {
          session_id: c.id,
          boot_id: s.bootId,
          nonce: info.nonce,
          drain: true,
        },
      );
      await link.command(ticket);
      // Reconnect for drain is permitted on the same session even after server STOP.
      const result = await link.drain();
      if (result.next_sequence > s.first) s.last = result.last_sequence;
      link.onFrames = null;
      await link.disconnect();
    }
    c.state = "stopped";
    c.error = undefined;
    await this.store.saveCapture(c);
    await this.flush();
  }
  foreground() {
    this.inForeground = true;
    void this.flush();
  }
  async background() {
    this.inForeground = false;
    this.stopRemote();
    this.ble.stopScan();
    if (this.simulation) this.stopSimulation();
    if (this.capture?.state === "recording") await this.stop();
  }
  startSimulation() {
    if (this.simulation) return;
    this.stopRemote();
    if (this.capture?.state === "recording")
      throw new Error("Hãy kết thúc phiên thật trước.");
    this.simulation = true;
    this.simStarted = Date.now();
    this.views = { left: empty(), right: empty() };
    let seq = 0;
    // Explicit local UI demo; no API writes and no hardware impersonation.
    this.simulationTimer = setInterval(() => {
      for (const side of ["left", "right"] as const) {
        const phase =
          (seq / 100) * 2 * Math.PI + (side === "left" ? 0 : Math.PI);
        const raw = Array.from({ length: 8 }, (_, k) =>
          Math.round(80 + 2100 * Math.max(0, Math.sin(phase - k * 0.12))),
        );
        this.updateView(side, [
          {
            sequence_no: seq,
            device_time_us: seq * 10000,
            fsr: raw,
            fsr_filtered: raw.slice(),
            filter_version: "simulation",
            fsr_valid_mask: 255,
            quality_flags: 1,
            imu: null,
          },
        ]);
      }
      seq++;
    }, 10);
    this.changed();
  }
  stopSimulation() {
    if (this.simulationTimer) clearInterval(this.simulationTimer);
    this.simulation = false;
    this.changed();
  }
  async logout() {
    if (this.starting)
      throw new Error("Hãy đợi quá trình chuẩn bị phiên kết thúc.");
    if (this.capture?.state === "recording") await this.stop();
    this.stopSimulation();
    this.stopRemote();
    await this.ble.disconnectAll();
    await this.api.post("/auth/logout").catch(() => {});
    await this.api.clearToken();
    this.capture = null;
    this.changed();
  }
}
