import React, { useEffect, useState, useRef } from "react";
import { Alert, Text, View } from "react-native";
import { randomUUID as uuid } from "expo-crypto";
import type { AppEngine } from "../state/engine";
import type { Session, LocalCapture } from "../domain/types";
import { styles as s } from "../ui/styles";
import { Button, Field, Badge, Chart } from "../ui/components";
export function History({
  engine,
  act,
}: {
  engine: AppEngine;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [items, setItems] = useState<Session[]>([]),
    [local, setLocal] = useState<LocalCapture[]>([]),
    [next, setNext] = useState<number | null>(0),
    [filter, setFilter] = useState(""),
    [detail, setDetail] = useState<Session | null>(null),
    [plots, setPlots] = useState<any[]>([]),
    [channel, setChannel] = useState(1),
    [frames, setFrames] = useState<any[]>([]),
    [after, setAfter] = useState(-1),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  async function load(offset = 0) {
    const q = new URLSearchParams({
      limit: "12",
      offset: String(offset),
      ...(filter ? { from: filter } : {}),
    });
    const result = await engine.api.request(`/sessions?${q}`);
    setItems((old) => (offset ? [...old, ...result.items] : result.items));
    setNext(result.next_offset);
    setLocal(await engine.store.captures(engine.api.owner, engine.api.base));
  }
  async function open(id: string) {
    setPlots([]);
    setFrames([]);
    setAfter(-1);
    setSelected("");
    const result: Session = await engine.api.request(`/sessions/${id}`);
    setDetail(result);
    const data = await Promise.all(
      (result.streams || []).map(async (stream: any) => ({
        ...stream,
        ...(await engine.api.request(`/streams/${stream.id}/plot?points=150`)),
      })),
    );
    setPlots(data);
  }
  const initialLoad = useRef(load);
  useEffect(() => {
    void initialLoad.current().catch((e) => setError(String(e)));
  }, []); // explicit refresh keeps history stable while browsing
  if (detail)
    return (
      <>
        <Button
          title="Quay lại lịch sử"
          secondary
          onPress={() => {
            setDetail(null);
          }}
        />
        <View style={s.card}>
          <Text style={s.h2}>Phiên {detail.id.slice(0, 8)}</Text>
          <Badge
            text={
              detail.transport === "simulator"
                ? "DỮ LIỆU MÔ PHỎNG"
                : detail.transport
            }
          />
          <Text style={s.text}>
            {detail.status} · {detail.activity}
          </Text>
          <Text style={s.muted}>
            {detail.started_at || "Chưa bắt đầu"} →{" "}
            {detail.ended_at || "Chưa kết thúc"}
          </Text>
          <Text style={s.muted}>
            {JSON.stringify(detail.reasons || detail.quality_flags || [])}
          </Text>
          {detail.notes ? <Text style={s.text}>{detail.notes}</Text> : null}
          {detail.status === "recording" && (
            <Button
              title="Dừng phiên trên server"
              onPress={() =>
                act(async () => {
                  if (engine.capture?.id === detail.id) await engine.stop();
                  else await engine.api.post(`/sessions/${detail.id}/stop`);
                  await open(detail.id);
                })
              }
            />
          )}
          {["uploading", "completed", "failed"].includes(detail.status) && (
            <Button
              title="Yêu cầu phân tích"
              onPress={() =>
                act(async () => {
                  await engine.api.post(`/sessions/${detail.id}/process`, {
                    request_key: uuid(),
                  });
                  await open(detail.id);
                })
              }
            />
          )}
          <Button
            secondary
            title="Cập nhật kết quả"
            onPress={() => act(() => open(detail.id))}
          />
        </View>
        <View style={s.row}>
          {Array.from({ length: 8 }, (_, i) => (
            <Button
              key={i}
              title={`K${i + 1}`}
              secondary={channel !== i + 1}
              onPress={() => setChannel(i + 1)}
            />
          ))}
        </View>
        {plots.map((stream) => (
          <View key={stream.id} style={s.card}>
            <Text style={s.h2}>
              {stream.side === "left" ? "Chân trái" : "Chân phải"}
            </Text>
            <Text style={s.muted}>
              {stream.frame_count ?? "—"} mẫu · Đuôi{" "}
              {stream.closed_at ? "đã đóng" : "chưa xác định"}
            </Text>
            <Chart
              channel={channel}
              data={(stream.frames || []).map((f: any) => ({
                raw: Number(f[`fsr_${channel}`]),
                filtered: null,
              }))}
            />
            <Text style={s.muted}>
              Lịch sử: bao cực đại ADC thô, kênh {channel}.
            </Text>
            <Button
              secondary
              title="Xem mẫu gốc và lọc"
              onPress={() =>
                act(async () => {
                  const page = await engine.api.request(
                    `/streams/${stream.id}/frames?limit=30&after_sequence=-1`,
                  );
                  setFrames(page.frames);
                  setAfter(page.next_after_sequence);
                  setSelected(String(stream.id));
                })
              }
            />
          </View>
        ))}
        {!!selected && (
          <View style={s.card}>
            <Text style={s.h2}>Mẫu kênh {channel}</Text>
            {frames.map((f) => (
              <Text key={f.sequence_no} style={s.muted}>
                #{f.sequence_no} · {f.device_time_us} µs · ADC{" "}
                {f[`fsr_${channel}`]} · Lọc{" "}
                {(typeof f.fsr_filtered === "string"
                  ? JSON.parse(f.fsr_filtered)
                  : f.fsr_filtered)?.[channel - 1] ?? "Chưa có"}
              </Text>
            ))}
            <Button
              secondary
              title="30 mẫu tiếp theo"
              onPress={() =>
                act(async () => {
                  const page = await engine.api.request(
                    `/streams/${selected}/frames?limit=30&after_sequence=${after}`,
                  );
                  setFrames(page.frames);
                  setAfter(page.next_after_sequence);
                })
              }
            />
          </View>
        )}
        {!!detail.metrics?.length && (
          <View style={s.card}>
            <Text style={s.h2}>Kết quả phân tích</Text>
            {detail.metrics.map((m: any, i: number) => (
              <Text key={i} style={s.text}>
                {m.scope} · {m.metric_code}:{" "}
                {m.metric_value ?? m.value ?? "Chưa tính"} {m.unit || ""} ·{" "}
                {m.quality}
              </Text>
            ))}
          </View>
        )}
        {(detail.snapshots || []).map((snap: any) => (
          <View key={snap.id} style={s.card}>
            <Text style={s.h2}>{snap.side} · Hiệu chuẩn</Text>
            <Text style={s.muted}>
              {snap.calibration_status || "Chưa có hiệu chuẩn lực"} · Giá trị{" "}
              {snap.value_mode}
            </Text>
          </View>
        ))}
      </>
    );
  return (
    <>
      <View style={s.card}>
        <Field
          label="Từ ngày (YYYY-MM-DD)"
          placeholder="2026-11-15"
          value={filter}
          onChangeText={setFilter}
        />
        <Button title="Tải lịch sử" onPress={() => act(() => load())} />
        {error ? <Text style={s.error}>{error}</Text> : null}
      </View>
      {local.map((c) => (
        <LocalRow
          key={c.id}
          c={c}
          engine={engine}
          act={act}
          refresh={() => load()}
        />
      ))}
      {items.map((item) => (
        <View key={item.id} style={s.card}>
          <Text style={s.h2}>{item.display_name || item.id.slice(0, 8)}</Text>
          <Badge
            text={item.transport === "simulator" ? "MÔ PHỎNG" : item.transport}
          />
          <Text style={s.text}>
            {item.activity} · {item.status}
          </Text>
          <Text style={s.muted}>{item.started_at || "Chưa bắt đầu"}</Text>
          <Button
            title="Mở kết quả"
            secondary
            onPress={() => act(() => open(item.id))}
          />
        </View>
      ))}
      {next !== null && (
        <Button
          secondary
          title="Tải thêm"
          onPress={() => act(() => load(next))}
        />
      )}
    </>
  );
}
function LocalRow({
  c,
  engine,
  act,
  refresh,
}: {
  c: LocalCapture;
  engine: AppEngine;
  act: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [counts, setCounts] = useState({ pending: 0, total: 0, blocked: 0 });
  useEffect(() => {
    void engine.store.counts(c).then(setCounts);
  }, [c, engine]);
  return (
    <View style={s.card}>
      <Text style={s.h2}>Bản lưu điện thoại · {c.id.slice(0, 8)}</Text>
      <Badge text={c.state} />
      <Text style={s.text}>
        {counts.pending}/{counts.total} lô chưa gửi · {counts.blocked} lô lỗi
        cần kiểm tra
      </Text>
      {c.error ? <Text style={s.error}>{c.error}</Text> : null}
      <Button
        secondary
        title="Thử đồng bộ"
        onPress={() =>
          act(async () => {
            await engine.store.retryBlocked(c);
            await engine.flush();
            await refresh();
          })
        }
      />
      {c.state === "synced" && (
        <Button
          secondary
          title="Xóa bản lưu đã đồng bộ"
          onPress={() => {
            Alert.alert(
              "Xóa bản lưu điện thoại",
              "Dữ liệu đã gửi vẫn còn trên server.",
              [
                { text: "Giữ lại", style: "cancel" },
                {
                  text: "Xóa",
                  style: "destructive",
                  onPress: () => {
                    void act(async () => {
                      await engine.store.removeSynced(c);
                      await refresh();
                    });
                  },
                },
              ],
            );
          }}
        />
      )}
      {c.state === "interrupted" && (
        <Button
          secondary
          title="Chốt phiên thiếu dữ liệu"
          onPress={() => {
            Alert.alert(
              "Chốt phiên bị gián đoạn",
              "Mẫu cuối chưa xác định sẽ giữ cờ thiếu dữ liệu. Bạn vẫn có thể thử lấy bộ đệm trước khi phân tích.",
              [
                { text: "Giữ phiên", style: "cancel" },
                {
                  text: "Chốt phiên",
                  onPress: () => {
                    void act(async () => {
                      c.state = "stopped";
                      await engine.store.saveCapture(c);
                      await engine.flush();
                      await refresh();
                    });
                  },
                },
              ],
            );
          }}
        />
      )}
      {(c.state === "interrupted" || !!c.error) && (
        <Button
          secondary
          title="Khôi phục bộ đệm ESP32"
          onPress={() =>
            act(async () => {
              await engine.recover(c);
              await refresh();
            })
          }
        />
      )}
    </View>
  );
}
