import { URL } from "react-native-url-polyfill";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
export const isDebugBuild = __DEV__;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export function validateBaseUrl(value: string, debug: boolean) {
  const url = new URL(value.trim());
  const privateHost =
    /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      url.hostname,
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(debug && url.protocol === "http:" && privateHost))
  )
    throw new Error("Cần HTTPS; bản debug cho phép HTTP mạng nội bộ.");
  return (
    url
      .toString()
      .replace(/\/$/, "")
      .replace(/\/api\/v1$/, "") + "/api/v1"
  );
}
export class ApiClient {
  base = "";
  token = "";
  owner = "";
  private tokenKey = "";
  async configure(base: string) {
    this.base = validateBaseUrl(base, isDebugBuild);
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      this.base,
    );
    this.tokenKey = `smartinsole.token.${hash}`;
    this.token = (await SecureStore.getItemAsync(this.tokenKey)) ?? "";
    this.owner = "";
  }
  async saveToken(token: string) {
    if (!this.tokenKey) throw new Error("API_NOT_CONFIGURED");
    await SecureStore.setItemAsync(this.tokenKey, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    });
    this.token = token;
  }
  async clearToken() {
    if (this.tokenKey) await SecureStore.deleteItemAsync(this.tokenKey);
    this.token = "";
    this.owner = "";
  }
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const response = await fetch(this.base + path, {
        method,
        signal: ctrl.signal as unknown as NonNullable<
          Parameters<typeof fetch>[1]
        >["signal"],
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload: any = await response.json();
      if (!response.ok)
        throw new ApiError(
          response.status,
          payload.error || `HTTP_${response.status}`,
          Number(response.headers.get("Retry-After") || 0),
        );
      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.request<T>(path, "POST", body);
  }
}
