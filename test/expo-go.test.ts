import { PermissionsAndroid } from "react-native";
import { BleTransport } from "../src/transport/ble";
import { isExpoGo, canUseBle } from "../src/runtime/environment";

jest.mock("react-native-ble-plx", () => {
  throw new Error("BLE native module must stay unloaded in Expo Go");
});

test("Expo Go constructs transport without loading any custom BLE native module", () => {
  expect(isExpoGo).toBe(true);
  expect(canUseBle).toBe(false);
  const transport = new BleTransport();
  expect(transport.links.size).toBe(0);
  transport.stopScan();
});
test("Expo Go rejects a hardware scan with instructions and never asks for Bluetooth permissions", async () => {
  const permissions = jest.spyOn(PermissionsAndroid, "requestMultiple");
  const transport = new BleTransport();
  await expect(transport.scan(jest.fn(), jest.fn(), jest.fn())).rejects.toThrow(
    "development build",
  );
  expect(permissions).not.toHaveBeenCalled();
  permissions.mockRestore();
});
