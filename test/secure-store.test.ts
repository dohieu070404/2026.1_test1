import * as SecureStore from "expo-secure-store";
import { ApiClient } from "../src/api/client";

test("SecureStore uses a valid hashed key for each backend and never puts a URL or token in the key", async () => {
  const api = new ApiClient();
  await api.configure("https://one.example/api/v1");
  await api.saveToken("A".repeat(43));
  const first = (SecureStore.setItemAsync as jest.Mock).mock.calls.at(-1);
  expect(first[0]).toMatch(/^smartinsole\.token\.[0-9a-f]{64}$/);
  expect(first[1]).toBe("A".repeat(43));
  expect(first[2].requireAuthentication).toBe(false);
  await api.configure("https://two.example/api/v1");
  await api.saveToken("B".repeat(43));
  const second = (SecureStore.setItemAsync as jest.Mock).mock.calls.at(-1);
  expect(second[0]).not.toBe(first[0]);
  await api.clearToken();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(second[0]);
  expect(api.token).toBe("");
});
