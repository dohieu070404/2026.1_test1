import { fromByteArray } from "base64-js";
import { BleLink } from "../src/transport/ble";
test("a transient reconnect failure retries instead of ending capture on the first attempt", async () => {
  jest.useFakeTimers();
  let disconnected!: () => void;
  const identity = { v: 3, side: "left", device_uid: "ESP-L", boot_id: "boot" };
  const device: any = {
    mtu: 247,
    discoverAllServicesAndCharacteristics: async () => device,
    readCharacteristicForService: async () => ({
      value: fromByteArray(
        Uint8Array.from(
          JSON.stringify(identity)
            .split("")
            .map((c) => c.charCodeAt(0)),
        ),
      ),
    }),
    monitorCharacteristicForService: () => ({ remove: () => {} }),
  };
  const manager: any = {
    connectToDevice: jest
      .fn()
      .mockResolvedValueOnce(device)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(device),
    cancelDeviceConnection: jest.fn(async () => {}),
    onDeviceDisconnected: (_id: string, callback: () => void) => {
      disconnected = callback;
      return { remove: () => {} };
    },
  };
  const link = new BleLink(manager, "aa");
  link.onReconnect = jest.fn(async () => {});
  await link.connect();
  disconnected();
  await jest.advanceTimersByTimeAsync(1000);
  expect(link.reconnecting).toBe(true);
  expect(link.state).toBe("ERROR");
  await jest.advanceTimersByTimeAsync(2000);
  expect(manager.connectToDevice).toHaveBeenCalledTimes(3);
  expect(link.reconnecting).toBe(false);
  expect(link.onReconnect).toHaveBeenCalledTimes(1);
  await link.disconnect();
  jest.useRealTimers();
});
