import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { AppEngine } from "../state/engine";
import { styles as s } from "../ui/styles";
import { Button, Chart, Foot, Badge } from "../ui/components";
import type { Side } from "../domain/types";
export function Monitor({
  engine,
  act,
}: {
  engine: AppEngine;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [side, setSide] = useState<Side>("left");
  const [channel, setChannel] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const view = engine.views[side],
    started = engine.simulation ? engine.simStarted : engine.capture?.startedAt;
  const running =
    engine.simulation ||
    engine.capture?.state === "recording" ||
    !!engine.remoteSession;
  return (
    <>
      <View style={s.card}>
        <View style={s.row}>
          <Badge text={running ? "Đang thu nhận" : "Đã dừng"} />
          <Text style={s.muted}>
            {started
              ? Math.max(0, Math.floor((clock - started) / 1000)) + " giây"
              : ""}
          </Text>
        </View>
        <View style={s.row}>
          <Foot
            side="left"
            values={engine.views.left.raw}
            mask={engine.views.left.mask}
          />
          <Foot
            side="right"
            values={engine.views.right.raw}
            mask={engine.views.right.mask}
          />
        </View>
        <Text style={s.muted}>
          Bố trí minh họa. Màu thể hiện ADC, chưa phải áp suất.
        </Text>
        {running && (
          <Button
            title="Kết thúc đo"
            onPress={() =>
              act(async () => {
                if (engine.remoteSession) {
                  await engine.api.post(
                    `/sessions/${engine.remoteSession}/stop`,
                  );
                  engine.stopRemote();
                  engine.changed();
                } else await engine.stop();
              })
            }
          />
        )}
      </View>
      <View style={s.row}>
        {(["left", "right"] as Side[]).map((value) => (
          <Button
            key={value}
            title={value === "left" ? "Chân trái" : "Chân phải"}
            secondary={side !== value}
            onPress={() => setSide(value)}
          />
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.h2}>{view.count.toLocaleString()} mẫu nhận</Text>
        <Text style={s.muted}>
          Thiếu {view.gaps} · Trùng {view.duplicates} · Flags {view.flags}
        </Text>
        <View style={s.row}>
          {Array.from({ length: 8 }, (_, i) => (
            <Button
              key={i}
              title={`K${i + 1}`}
              secondary={channel !== i}
              onPress={() => setChannel(i)}
            />
          ))}
        </View>
        <Chart
          channel={channel + 1}
          data={view.trace.map((p) => ({
            raw: p.channels?.[channel] ?? p.raw,
            filtered: p.filteredChannels?.[channel] ?? p.filtered,
          }))}
        />
        <Text style={s.muted}>Kênh {channel + 1}</Text>
      </View>
      <View style={s.row}>
        {view.raw.map((value, i) => (
          <View style={s.channel} key={i}>
            <Text style={s.muted}>
              Cảm biến {i + 1} ·{" "}
              {view.mask & (1 << i) ? "Hoạt động" : "Chưa có / lỗi"}
            </Text>
            <Text style={s.value}>{value}</Text>
            <Text style={s.muted}>
              Lọc: {view.filtered[i] ?? "Chưa có"} ADC
            </Text>
          </View>
        ))}
      </View>
      {engine.capture?.error && (
        <Text style={s.error}>{engine.capture.error}</Text>
      )}
    </>
  );
}
