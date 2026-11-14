import { toByteArray } from "base64-js";
import type { SensorFrame } from "./types";
export const SERVICE = "327e0001-4f41-4e53-4f4c-453300000001";
export const IDENTITY = "327e0002-4f41-4e53-4f4c-453300000001";
export const CONTROL = "327e0003-4f41-4e53-4f4c-453300000001";
export const DATA = "327e0004-4f41-4e53-4f4c-453300000001";
export const FILTER_VERSION = "ema10-exp-v1";
export function decodePacket(base64: string): SensorFrame[] {
  const b = toByteArray(base64);
  if (
    b.length < 2 ||
    b[0] !== 3 ||
    b[1] < 1 ||
    b[1] > 3 ||
    b.length !== 2 + b[1] * 77
  )
    throw new Error("BLE_PACKET_INVALID");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u64 = (p: number) => {
    const n = v.getUint32(p, true) + v.getUint32(p + 4, true) * 4294967296;
    if (!Number.isSafeInteger(n)) throw new Error("BLE_INTEGER_OVERFLOW");
    return n;
  };
  const frames: SensorFrame[] = [];
  for (let p = 2; p < b.length; p += 77) {
    const flags = v.getUint32(p + 49, true);
    const frame: SensorFrame = {
      sequence_no: u64(p),
      device_time_us: u64(p + 8),
      fsr: Array.from({ length: 8 }, (_, k) =>
        v.getUint16(p + 16 + k * 2, true),
      ),
      fsr_filtered: Array.from({ length: 8 }, (_, k) =>
        v.getUint16(p + 32 + k * 2, true),
      ),
      fsr_valid_mask: b[p + 48],
      quality_flags: flags,
      filter_version: FILTER_VERSION,
      imu:
        flags & 1
          ? null
          : Array.from({ length: 6 }, (_, k) =>
              v.getFloat32(p + 53 + k * 4, true),
            ),
    };
    if (
      frame.fsr.some((n) => n > 4095) ||
      frame.fsr_filtered.some((n) => n > 4095) ||
      frame.imu?.some((n) => !Number.isFinite(n) || Math.abs(n) >= 1e6)
    )
      throw new Error("BLE_SAMPLE_INVALID");
    const prior = frames.at(-1);
    if (
      prior &&
      (prior.sequence_no >= frame.sequence_no ||
        prior.device_time_us >= frame.device_time_us)
    )
      throw new Error("BLE_NON_MONOTONIC");
    frames.push(frame);
  }
  return frames;
}
export class SequenceTracker {
  last = -1;
  time = -1;
  gaps = 0;
  duplicates = 0;
  observe(frames: SensorFrame[]) {
    const fresh: SensorFrame[] = [];
    for (const frame of frames) {
      if (frame.sequence_no <= this.last) {
        this.duplicates++;
        continue;
      }
      if (frame.device_time_us <= this.time)
        throw new Error("BLE_CLOCK_REVERSED");
      if (this.last >= 0) this.gaps += frame.sequence_no - this.last - 1;
      this.last = frame.sequence_no;
      this.time = frame.device_time_us;
      fresh.push(frame);
    }
    return fresh;
  }
}
