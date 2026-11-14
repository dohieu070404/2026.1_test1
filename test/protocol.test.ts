import { fromByteArray } from "base64-js";
import { decodePacket, SequenceTracker } from "../src/domain/protocol";
function packet(sequence = 0, time = 10000, count = 3) {
  const b = new Uint8Array(2 + 77 * count),
    v = new DataView(b.buffer);
  b[0] = 3;
  b[1] = count;
  for (let i = 0; i < count; i++) {
    const p = 2 + 77 * i;
    v.setUint32(p, sequence + i, true);
    v.setUint32(p + 8, time + i * 10000, true);
    for (let k = 0; k < 8; k++) {
      v.setUint16(p + 16 + k * 2, 100 + k, true);
      v.setUint16(p + 32 + k * 2, 90 + k, true);
    }
    b[p + 48] = 255;
    v.setUint32(p + 49, 1, true);
  }
  return b;
}
test("decodes exact eight raw and eight filtered channels without a physical-unit conversion", () => {
  const frames = decodePacket(fromByteArray(packet()));
  expect(frames).toHaveLength(3);
  expect(frames[0]).toMatchObject({
    sequence_no: 0,
    device_time_us: 10000,
    fsr: [100, 101, 102, 103, 104, 105, 106, 107],
    fsr_filtered: [90, 91, 92, 93, 94, 95, 96, 97],
    imu: null,
    fsr_valid_mask: 255,
  });
});
test("rejects bad version, truncation, ADC range and unsafe u64", () => {
  const wrong = packet();
  wrong[0] = 2;
  expect(() => decodePacket(fromByteArray(wrong))).toThrow();
  expect(() => decodePacket(fromByteArray(packet().slice(1)))).toThrow();
  const high = packet();
  new DataView(high.buffer).setUint16(18, 65535, true);
  expect(() => decodePacket(fromByteArray(high))).toThrow("BLE_SAMPLE_INVALID");
  const overflow = packet();
  new DataView(overflow.buffer).setUint32(6, 0x200000, true);
  expect(() => decodePacket(fromByteArray(overflow))).toThrow(
    "BLE_INTEGER_OVERFLOW",
  );
});
test("tracks missing samples, ignores duplicates and rejects a reversed monotonic clock", () => {
  const t = new SequenceTracker();
  expect(t.observe(decodePacket(fromByteArray(packet())))).toHaveLength(3);
  expect(t.observe(decodePacket(fromByteArray(packet())))).toHaveLength(0);
  expect(t.duplicates).toBe(3);
  t.observe(decodePacket(fromByteArray(packet(5, 60000))));
  expect(t.gaps).toBe(2);
  expect(() => t.observe(decodePacket(fromByteArray(packet(8, 1000))))).toThrow(
    "BLE_CLOCK_REVERSED",
  );
});
