jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));
jest.mock("expo-crypto", () => {
  const crypto = require("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (_algorithm, value) =>
      crypto.createHash("sha256").update(value).digest("hex"),
    randomUUID: () => crypto.randomUUID(),
  };
});
jest.mock("expo-sqlite", () => {
  const { DatabaseSync } = require("node:sqlite");
  return {
    openDatabaseAsync: async () => {
      const db = new DatabaseSync(":memory:");
      return {
        getAllAsync: async (sql, args = []) => db.prepare(sql).all(...args),
        runAsync: async (sql, args = []) => db.prepare(sql).run(...args),
      };
    },
  };
});
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { executionEnvironment: "storeClient" },
  ExecutionEnvironment: { StoreClient: "storeClient", Bare: "bare" },
}));
jest.mock("react-native-ble-plx", () => ({ BleManager: jest.fn() }));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
