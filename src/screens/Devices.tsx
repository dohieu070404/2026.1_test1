import { canUseBle, BLE_BUILD_MESSAGE } from "../runtime/environment";
import React, { useState, useEffect } from "react";
import { Text, View } from "react-native";
import type { Device } from "react-native-ble-plx";
import type { AppEngine } from "../state/engine";
import type { Pair } from "../domain/types";
import { styles as s } from "../ui/styles";
import { Button, Field, Badge } from "../ui/components";
export function Devices({
  engine,
  pairs,
  refresh,
  act,
  onStarted,
}: {
  engine: AppEngine;
  pairs: Pair[];
  refresh: () => Promise<void>;
  act: (fn: () => Promise<void>) => Promise<void>;
  onStarted: () => void;
}) {
  const [found, setFound] = useState<Device[]>(
      [...engine.ble.links.values()]
        .map((l) => l.device)
        .filter((d): d is Device => !!d),
    ),
    [scanning, setScanning] = useState(false),
    [scanError, setScanError] = useState("");
  const [pairUid, setPairUid] = useState(""),
    [claim, setClaim] = useState(""),
    [activity, setActivity] = useState("walking"),
    [notes, setNotes] = useState(""),
    [rename, setRename] = useState<Record<string, string>>({});
  useEffect(() => () => engine.ble.stopScan(), [engine]);
  return (
    <>
      <View style={s.card}>
        <Text style={s.h2}>Thiết bị ở gần</Text>
        {!canUseBle && <Text style={s.muted}>{BLE_BUILD_MESSAGE}</Text>}
        <Button
          title={scanning ? "Dừng quét" : "Quét Bluetooth"}
          disabled={!canUseBle}
          onPress={() =>
            act(async () => {
              if (scanning) {
                engine.ble.stopScan();
                setScanning(false);
                return;
              }
              setFound([]);
              setScanError("");
              setScanning(true);
              try {
                await engine.ble.scan(
                  (d) =>
                    setFound((list) =>
                      list.some((x) => x.id === d.id) ? list : [...list, d],
                    ),
                  () => setScanning(false),
                  (e) => setScanError(e.message),
                );
              } catch (e) {
                setScanning(false);
                throw e;
              }
            })
          }
        />
        {scanError ? <Text style={s.error}>{scanError}</Text> : null}
        {found.map((device) => {
          const link = engine.ble.links.get(device.id);
          const identity = link?.identity;
          return (
            <View key={device.id} style={s.card}>
              <Text style={s.text}>
                {device.localName || device.name || "SmartInsole"}
              </Text>
              <Text style={s.muted}>
                {identity?.device_uid || device.id} · RSSI {device.rssi ?? "—"}
              </Text>
              <Badge text={link?.state || "DISCONNECTED"} />
              {identity && (
                <Text style={s.muted}>
                  {identity.side === "left" ? "Chân trái" : "Chân phải"} · FW{" "}
                  {identity.firmware_version} · Protocol{" "}
                  {identity.protocol_version} · Pin{" "}
                  {identity.battery_percent === null
                    ? "Chưa xác định"
                    : `${identity.battery_percent}%`}
                </Text>
              )}
              {link?.error ? <Text style={s.error}>{link.error}</Text> : null}
              <Button
                secondary
                title={link?.device ? "Ngắt kết nối" : "Kết nối"}
                disabled={engine.capture?.state === "recording"}
                onPress={() =>
                  act(async () => {
                    if (link?.device) await link.disconnect();
                    else {
                      const connected = await engine.ble.connect(device.id);
                      connected.onState = engine.changed;
                    }
                    engine.changed();
                  })
                }
              />
            </View>
          );
        })}
        {!scanning && !found.length && (
          <Text style={s.muted}>Bật firmware có BLE để tìm thiết bị.</Text>
        )}
      </View>
      <View style={s.card}>
        <Text style={s.h2}>Nhận quyền sở hữu cặp lót</Text>
        <Field
          label="Pair UID"
          value={pairUid}
          autoCapitalize="none"
          onChangeText={setPairUid}
        />
        <Field
          label="Mã claim dùng một lần"
          value={claim}
          autoCapitalize="none"
          secureTextEntry
          onChangeText={setClaim}
        />
        <Button
          title="Liên kết với tài khoản"
          onPress={() =>
            act(async () => {
              await engine.api.post("/pairs/claim", {
                pair_uid: pairUid.trim(),
                claim_code: claim.trim(),
              });
              setClaim("");
              await refresh();
            })
          }
        />
      </View>
      <View style={s.card}>
        <Text style={s.h2}>Chuẩn bị phiên đo</Text>
        <View style={s.row}>
          {[
            { id: "walking", name: "Đi bộ" },
            { id: "standing", name: "Đứng" },
            { id: "running", name: "Chạy" },
            { id: "other", name: "Khác" },
          ].map((a) => (
            <Button
              key={a.id}
              title={a.name}
              secondary={activity !== a.id}
              onPress={() => setActivity(a.id)}
            />
          ))}
        </View>
        <Field
          label="Ghi chú phiên đo"
          value={notes}
          onChangeText={setNotes}
          maxLength={2000}
          multiline
        />
      </View>
      {pairs.map((pair) => (
        <View style={s.card} key={pair.pair_uid}>
          <Text style={s.h2}>{pair.display_name}</Text>
          <Text selectable style={s.muted}>
            {pair.pair_uid}
          </Text>
          <Badge
            text={pair.source === "simulator" ? "Bộ mô phỏng" : "Phần cứng"}
          />
          {pair.devices.map((d) => (
            <Text key={d.device_uid} style={s.muted}>
              {d.side === "left" ? "Trái" : "Phải"} · {d.device_uid} · Pin{" "}
              {d.last_battery_percent ?? "—"} ·{" "}
              {d.firmware_version || "Chưa rõ firmware"}
            </Text>
          ))}
          <Field
            label="Tên cặp lót"
            value={rename[pair.pair_uid] ?? pair.display_name}
            onChangeText={(name) =>
              setRename((x) => ({ ...x, [pair.pair_uid]: name }))
            }
          />
          <Button
            secondary
            title="Lưu tên"
            onPress={() =>
              act(async () => {
                await engine.api.request(`/pairs/${pair.pair_uid}`, "PATCH", {
                  display_name: rename[pair.pair_uid] ?? pair.display_name,
                });
                await refresh();
              })
            }
          />
          {pair.source !== "simulator" && (
            <>
              <Button
                title="Bắt đầu đo qua Bluetooth"
                disabled={
                  engine.capture?.state === "recording" || engine.simulation
                }
                onPress={() =>
                  act(async () => {
                    await engine.start(pair, activity, notes);
                    onStarted();
                  })
                }
              />
              <Button
                secondary
                title="Tạo phiên Wi-Fi trên server"
                onPress={() =>
                  act(async () => {
                    const c = await engine.api.post("/sessions", {
                      pair_uid: pair.pair_uid,
                      transport: "wifi_https",
                      activity,
                      notes,
                      target_sample_rate_hz: 100,
                    });
                    await engine.api.post(`/sessions/${c.session_id}/start`);
                    await refresh();
                  })
                }
              />
            </>
          )}
        </View>
      ))}
    </>
  );
}
