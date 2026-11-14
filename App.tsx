import { StatusBar } from "expo-status-bar";
import "react-native-url-polyfill/auto";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AppEngine } from "./src/state/engine";
import { styles as s, colors } from "./src/ui/styles";
import { Button, Field, Badge } from "./src/ui/components";
import { Devices } from "./src/screens/Devices";
import { History } from "./src/screens/History";
import { Monitor } from "./src/screens/Monitor";
import type { Pair } from "./src/domain/types";
const engine = new AppEngine();
type Tab = "home" | "devices" | "monitor" | "history" | "settings";
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}
function Main() {
  const [ready, setReady] = useState(false),
    [bootError, setBootError] = useState(""),
    [, rerender] = useState(0),
    [me, setMe] = useState<any>(null),
    [tab, setTab] = useState<Tab>("home"),
    [error, setError] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]),
    [overview, setOverview] = useState<any>(null),
    [base, setBase] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [register, setRegister] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const refresh = async () => {
    const [p, o] = await Promise.all([
      engine.api.request<Pair[]>("/pairs"),
      engine.api.request("/overview"),
    ]);
    setPairs(p);
    setOverview(o);
  };
  useEffect(() => engine.subscribe(() => rerender((x) => x + 1)), []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await engine.initialize();
        if (cancelled) return;
        setBase(engine.api.base);
        if (engine.api.token) {
          try {
            setMe(await engine.signedIn());
            await refresh();
          } catch (e) {
            setError(String(e));
          }
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setBootError(String(e));
      }
    })();
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active")
        void engine.background().catch((e) => setError(String(e)));
      else engine.foreground();
    });
    return () => {
      cancelled = true;
      listener.remove();
      void engine.dispose().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (engine.simulation && !me) {
        engine.stopSimulation();
        return true;
      }
      if (tab !== "home") {
        setTab("home");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab, me]);
  if (!ready)
    return (
      <SafeAreaView style={[s.root, s.center]}>
        <Text style={s.brand}>SMARTINSOLE</Text>
        {bootError ? (
          <Text style={s.error}>{bootError}</Text>
        ) : (
          <ActivityIndicator color={colors.green} />
        )}
      </SafeAreaView>
    );
  const titles: Record<Tab, string> = {
    home: "Tổng quan",
    devices: "Thiết bị",
    monitor: "Theo dõi trực tiếp",
    history: "Lịch sử đo",
    settings: "Tài khoản",
  };
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Text style={s.brand}>SMARTINSOLE</Text>
        <Text style={s.title}>
          {me
            ? titles[tab]
            : engine.simulation
              ? "Theo dõi mô phỏng"
              : "Kết nối từng bước chân"}
        </Text>
      </View>
      {engine.simulation && (
        <View style={s.banner}>
          <Text style={s.bannerText}>
            DỮ LIỆU MÔ PHỎNG · Không lưu như phiên đo thật
          </Text>
        </View>
      )}
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          {error ? (
            <View style={s.card}>
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            </View>
          ) : null}
          {!me && engine.simulation ? (
            <>
              <Button
                title="Về đăng nhập"
                secondary
                onPress={() => engine.stopSimulation()}
              />
              <Monitor engine={engine} act={act} />
            </>
          ) : !me ? (
            <>
              <View style={s.card}>
                <Text style={s.h2}>Chạy thử trên máy ảo</Text>
                <Text style={s.muted}>
                  Xem dữ liệu hai chân và biểu đồ mà chưa cần server hoặc ESP32.
                </Text>
                <Button
                  title="Thử mô phỏng không cần tài khoản"
                  onPress={() =>
                    act(async () => {
                      engine.startSimulation();
                    })
                  }
                />
              </View>
              <View style={s.card}>
                <Text style={s.h2}>
                  {register ? "Tạo tài khoản" : "Đăng nhập"}
                </Text>
                {register && (
                  <Field
                    label="Họ và tên"
                    value={name}
                    onChangeText={setName}
                  />
                )}
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                <Field
                  label="Mật khẩu"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete={register ? "new-password" : "current-password"}
                />
                <Button
                  title={register ? "Đăng ký" : "Đăng nhập"}
                  onPress={() =>
                    act(async () => {
                      await engine.api.configure(base);
                      await engine.store.setSetting("server", engine.api.base);
                      const result = await engine.api.post(
                        register ? "/auth/register" : "/auth/login",
                        { email, password, full_name: name },
                      );
                      await engine.api.saveToken(result.access_token);
                      setPassword("");
                      setMe(await engine.signedIn());
                      await refresh();
                    })
                  }
                />
                <Button
                  secondary
                  title={register ? "Đã có tài khoản" : "Tạo tài khoản mới"}
                  onPress={() => setRegister(!register)}
                />
              </View>
              <View style={s.card}>
                <Field
                  label="Địa chỉ Backend API"
                  value={base}
                  autoCapitalize="none"
                  onChangeText={setBase}
                />
                <Text style={s.muted}>
                  Emulator: http://10.0.2.2:8081/api/v1
                </Text>
              </View>
            </>
          ) : (
            <>
              {tab === "home" && (
                <>
                  <View style={s.card}>
                    <Text style={s.h2}>Xin chào, {me.full_name}</Text>
                    <View style={s.row}>
                      <Badge text={`${overview?.pair_count ?? "—"} cặp lót`} />
                      <Badge
                        text={`${overview?.total_sessions ?? "—"} phiên`}
                      />
                    </View>
                    <Button
                      title="Kết nối thiết bị"
                      onPress={() => setTab("devices")}
                    />
                    <Button
                      secondary
                      title="Làm mới"
                      onPress={() => act(refresh)}
                    />
                  </View>
                  {(overview?.active || []).map((session: any) => (
                    <View key={session.id} style={s.card}>
                      <Text style={s.h2}>{session.display_name}</Text>
                      <Text style={s.text}>
                        {session.activity} · {session.status}
                      </Text>
                      <Text style={s.muted}>
                        {session.transport} · {session.id.slice(0, 8)}
                      </Text>
                      <Button
                        secondary
                        title="Xem trực tiếp từ server"
                        onPress={() =>
                          act(async () => {
                            await engine.watchRemote(session.id);
                            setTab("monitor");
                          })
                        }
                      />
                      <Button
                        secondary
                        title="Mở phiên trong lịch sử"
                        onPress={() => setTab("history")}
                      />
                    </View>
                  ))}
                  <View style={s.card}>
                    <Text style={s.h2}>Mô phỏng trên điện thoại</Text>
                    <Button
                      secondary
                      title={
                        engine.simulation ? "Dừng mô phỏng" : "Bắt đầu mô phỏng"
                      }
                      onPress={() =>
                        act(async () => {
                          if (engine.simulation) engine.stopSimulation();
                          else {
                            engine.startSimulation();
                            setTab("monitor");
                          }
                        })
                      }
                    />
                  </View>
                </>
              )}
              {tab === "devices" && (
                <Devices
                  engine={engine}
                  pairs={pairs}
                  refresh={refresh}
                  act={act}
                  onStarted={() => setTab("monitor")}
                />
              )}
              {tab === "monitor" && <Monitor engine={engine} act={act} />}
              {tab === "history" && <History engine={engine} act={act} />}
              {tab === "settings" && (
                <>
                  <View style={s.card}>
                    <Text style={s.h2}>Hồ sơ</Text>
                    <Text style={s.text}>{me.email}</Text>
                    <Field
                      label="Họ và tên"
                      value={name || me.full_name}
                      onChangeText={setName}
                    />
                    <Button
                      title="Lưu hồ sơ"
                      onPress={() =>
                        act(async () => {
                          await engine.api.request("/me", "PATCH", {
                            full_name: name || me.full_name,
                          });
                          setMe(await engine.api.request("/me"));
                        })
                      }
                    />
                    <Button
                      secondary
                      title="Làm mới phiên đăng nhập"
                      onPress={() =>
                        act(async () => {
                          const result = await engine.api.post("/auth/refresh");
                          await engine.api.saveToken(result.access_token);
                        })
                      }
                    />
                  </View>
                  <View style={s.card}>
                    <Text style={s.h2}>Đồng bộ</Text>
                    <Text selectable style={s.muted}>
                      {engine.api.base}
                    </Text>
                    <Text style={s.muted}>
                      Khi chuyển nền hoặc khóa màn hình, app kết thúc thu BLE và
                      giữ các lô chưa gửi. Sau khi mở lại, kiểm tra lịch sử để
                      đồng bộ hoặc khôi phục.
                    </Text>
                    {engine.error ? (
                      <Text style={s.error}>{engine.error}</Text>
                    ) : null}
                    <Button
                      title={engine.syncing ? "Đang đồng bộ" : "Đồng bộ ngay"}
                      disabled={engine.syncing}
                      onPress={() => act(() => engine.flush())}
                    />
                  </View>
                  <Button
                    secondary
                    title="Đăng xuất"
                    onPress={() =>
                      act(async () => {
                        await engine.logout();
                        setMe(null);
                        setTab("home");
                      })
                    }
                  />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {me && (
        <View style={s.tabs}>
          {(
            [
              { id: "home", name: "Tổng quan" },
              { id: "devices", name: "Thiết bị" },
              { id: "monitor", name: "Trực tiếp" },
              { id: "history", name: "Lịch sử" },
              { id: "settings", name: "Tài khoản" },
            ] as { id: Tab; name: string }[]
          ).map((item) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item.id }}
              key={item.id}
              onPress={() => setTab(item.id)}
              style={s.tab}
            >
              <Text style={[s.tabText, tab === item.id && s.activeTab]}>
                {item.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}
