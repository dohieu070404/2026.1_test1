import { canUseBle, BLE_BUILD_MESSAGE } from "../runtime/environment";
import type { BleManager, Device, Subscription } from "react-native-ble-plx";
import { PermissionsAndroid, Platform } from "react-native";
import { fromByteArray, toByteArray } from "base64-js";
import {
  SERVICE,
  IDENTITY,
  CONTROL,
  DATA,
  decodePacket,
} from "../domain/protocol";
import type { DeviceIdentity, LinkState, SensorFrame } from "../domain/types";
const encode = (s: string) =>
  fromByteArray(Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0))));
const decode = (s: string) => String.fromCharCode(...toByteArray(s));
export class BleLink {
  device?: Device;
  identity?: DeviceIdentity;
  state: LinkState = "DISCONNECTED";
  error = "";
  reconnecting = false;
  private sub?: Subscription;
  private dis?: Subscription;
  private active = true;
  private generation = 0;
  private receiving = Promise.resolve();
  private watchdog?: ReturnType<typeof setInterval>;
  private lastPacketAt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private tries = 0;
  onState: () => void = () => {};
  onFrames: ((frames: SensorFrame[]) => Promise<void>) | null = null;
  onReconnect: (() => Promise<void>) | null = null;
  constructor(
    private manager: BleManager,
    public id: string,
  ) {}
  private set(state: LinkState) {
    this.state = state;
    this.onState();
  }
  async connect() {
    this.active = true;
    const generation = ++this.generation;
    this.set("CONNECTING");
    try {
      const device = await this.manager.connectToDevice(this.id, {
        timeout: 12000,
        requestMTU: 247,
      });
      if (generation !== this.generation || !this.active) {
        await device.cancelConnection();
        return;
      }
      this.device = await device.discoverAllServicesAndCharacteristics();
      if ((this.device.mtu ?? 23) < 236) throw new Error("BLE_MTU_TOO_SMALL");
      this.identity = await this.readIdentity();
      if (
        this.identity.v !== 3 ||
        !["left", "right"].includes(this.identity.side)
      )
        throw new Error("BLE_PROTOCOL_MISMATCH");
      this.set("CONNECTED");

      this.dis?.remove();
      this.dis = this.manager.onDeviceDisconnected(this.id, () => {
        this.sub?.remove();
        this.device = undefined;
        this.reconnecting = this.active && !!this.onReconnect;
        this.set("DISCONNECTED");
        if (this.reconnecting) this.scheduleReconnect();
      });
      this.sub?.remove();
      this.sub = this.device.monitorCharacteristicForService(
        SERVICE,
        DATA,
        (error, value) => {
          if (error) {
            this.error = error.message;
            this.onState();
            return;
          }
          if (!value?.value || !this.onFrames) return;
          this.lastPacketAt = Date.now();
          const payload = value.value;
          this.receiving = this.receiving
            .then(async () => {
              const frames = decodePacket(payload);
              await this.onFrames!(frames);
              await this.command({ op: "ack", q: frames.at(-1)!.sequence_no });
            })
            .catch(async (e) => {
              this.error = String(e);
              this.set("ERROR");
              // Stop generation, retain unacknowledged packet. Never ACK failed persistence.
              try {
                await this.command({ op: "stop" });
              } catch {}
              this.onFrames = null;
            });
        },
      );
    } catch (e) {
      this.error = String(e);
      this.set("ERROR");
      if (this.device)
        await this.manager.cancelDeviceConnection(this.id).catch(() => {});
      throw e;
    }
  }
  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(
      async () => {
        if (!this.active || !this.onReconnect) return;
        try {
          await this.connect();
          if (!this.active || !this.onReconnect) return;
          await this.onReconnect();
          this.reconnecting = false;
          this.tries = 0;
        } catch {
          if (this.active && this.tries < 5) this.scheduleReconnect();
          else if (this.active) {
            this.reconnecting = false;
            this.error = "BLE_RECONNECT_EXHAUSTED";
            this.set("ERROR");
          }
        }
      },
      Math.min(30000, 1000 * 2 ** Math.min(this.tries++, 5)),
    );
  }
  async readIdentity(): Promise<DeviceIdentity> {
    const c = await this.device!.readCharacteristicForService(
      SERVICE,
      IDENTITY,
    );
    if (!c.value) throw new Error("BLE_NO_IDENTITY");
    return JSON.parse(decode(c.value));
  }
  async waitForIdentity(
    test: (info: DeviceIdentity) => boolean,
    timeout = 5000,
  ): Promise<DeviceIdentity> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const info = await this.readIdentity();
      if (test(info)) return info;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("BLE_COMMAND_TIMEOUT");
  }
  async command(body: unknown) {
    if (!this.device) throw new Error("BLE_DISCONNECTED");
    await this.device.writeCharacteristicWithResponseForService(
      SERVICE,
      CONTROL,
      encode(JSON.stringify(body)),
    );
  }
  streaming() {
    this.set("STREAMING");
    this.lastPacketAt = Date.now();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.state === "STREAMING" && Date.now() - this.lastPacketAt > 5000) {
        this.error = "BLE_SIGNAL_TIMEOUT";
        this.set("ERROR");
      }
    }, 1000);
  }
  async drain(timeout = 15000) {
    await this.command({ op: "stop" });
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      await this.receiving;
      const info = await this.readIdentity();
      if (!info.recording && info.pending === 0) return info;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("BLE_DRAIN_TIMEOUT_TAIL_UNKNOWN");
  }
  async disconnect() {
    this.active = false;
    this.reconnecting = false;
    if (this.watchdog) clearInterval(this.watchdog);
    ++this.generation;
    this.onReconnect = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.set("DISCONNECTING");
    this.sub?.remove();
    this.dis?.remove();
    if (this.device)
      await this.manager.cancelDeviceConnection(this.id).catch(() => {});
    this.device = undefined;
    this.set("DISCONNECTED");
  }
}
export class BleTransport {
  private manager?: BleManager;
  private get native() {
    if (!canUseBle) throw new Error(BLE_BUILD_MESSAGE);
    if (!this.manager) {
      // Never evaluate the custom native BLE module inside Expo Go.
      /* eslint-disable @typescript-eslint/no-require-imports -- Expo Go must not evaluate this module eagerly. */
      const { BleManager: NativeBleManager } =
        require("react-native-ble-plx") as typeof import("react-native-ble-plx");
      this.manager = new NativeBleManager();
      /* eslint-enable @typescript-eslint/no-require-imports */
    }
    return this.manager;
  }
  links = new Map<string, BleLink>();
  private scanTimer?: ReturnType<typeof setTimeout>;
  async permissions() {
    if (!canUseBle) throw new Error(BLE_BUILD_MESSAGE);
    if (Platform.OS !== "android") return;
    const permissions =
      Number(Platform.Version) >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const result = await PermissionsAndroid.requestMultiple(permissions);
    if (
      permissions.some((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED)
    )
      throw new Error("Chưa cấp quyền tìm thiết bị Bluetooth.");
    if ((await this.native.state()) !== "PoweredOn")
      throw new Error("Hãy bật Bluetooth.");
  }
  async scan(
    found: (d: Device) => void,
    done: () => void,
    error: (e: Error) => void,
  ) {
    await this.permissions();
    this.stopScan();
    this.native.startDeviceScan(
      [SERVICE],
      { allowDuplicates: false },
      (e, d) => {
        if (e) {
          this.stopScan();
          done();
          error(e);
          return;
        }
        if (d) found(d);
      },
    );
    this.scanTimer = setTimeout(() => {
      this.stopScan();
      done();
    }, 10000);
  }
  stopScan() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.manager?.stopDeviceScan();
  }
  async connect(id: string) {
    this.stopScan();
    await this.permissions();
    const old = this.links.get(id);
    if (old?.device) return old;
    const link = old ?? new BleLink(this.native, id);
    this.links.set(id, link);
    await link.connect();
    return link;
  }
  async disconnectAll() {
    this.stopScan();
    for (const link of this.links.values()) await link.disconnect();
    this.links.clear();
  }
}
