import { validateBaseUrl } from "../src/api/client";
test("standalone debug accepts private emulator/LAN endpoints and normalizes the prefix", () => {
  expect(validateBaseUrl("http://10.0.2.2:8081/", true)).toBe(
    "http://10.0.2.2:8081/api/v1",
  );
  expect(validateBaseUrl("http://192.168.1.7:8081/api/v1", true)).toBe(
    "http://192.168.1.7:8081/api/v1",
  );
});
test("release requires HTTPS and rejects credentials or query tokens in server configuration", () => {
  expect(() => validateBaseUrl("http://10.0.2.2:8081", false)).toThrow();
  expect(() =>
    validateBaseUrl("https://user:password@example.com", false),
  ).toThrow();
  expect(() =>
    validateBaseUrl("https://example.com/?token=secret", false),
  ).toThrow();
  expect(validateBaseUrl("https://example.com/api/v1/", false)).toBe(
    "https://example.com/api/v1",
  );
});
