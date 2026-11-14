import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Svg, { Path, Polyline, Circle, Text as SvgText } from "react-native-svg";
import { styles as s, colors } from "./styles";
import type { SensorView, Side } from "../domain/types";
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void | Promise<void>;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || busy}
      onPress={async () => {
        setBusy(true);
        try {
          await onPress();
        } finally {
          setBusy(false);
        }
      }}
      style={[
        s.button,
        secondary && s.secondary,
        (disabled || busy) && s.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.green : "#fff"} />
      ) : (
        <Text style={[s.buttonText, secondary && s.secondaryText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.muted}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={s.input}
        {...props}
      />
    </View>
  );
}
export function Badge({ text }: { text: string }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{text}</Text>
    </View>
  );
}
export function Chart({
  data,
  channel = 1,
}: {
  data: SensorView["trace"];
  channel?: number;
}) {
  const line = (key: "raw" | "filtered") =>
    data
      .map(
        (v, i) =>
          `${(i / Math.max(1, data.length - 1)) * 300},${100 - ((v[key] ?? 0) / 4095) * 94}`,
      )
      .join(" ");
  return (
    <View>
      <Svg
        height={120}
        viewBox="0 0 310 110"
        accessibilityLabel="Biểu đồ ADC kênh 1"
      >
        <Path d="M0 0V100H300" stroke={colors.line} />
        <Polyline
          points={line("raw")}
          fill="none"
          stroke="#9aaeb1"
          strokeWidth={1}
        />
        {data.some((v) => v.filtered !== null) && (
          <Polyline
            points={line("filtered")}
            fill="none"
            stroke={colors.green}
            strokeWidth={2}
          />
        )}
      </Svg>
      <Text style={s.muted}>Kênh {channel} · ADC thô (xám) · lọc (xanh)</Text>
    </View>
  );
}
export function Foot({
  side,
  values,
  mask,
  points,
}: {
  side: Side;
  values: number[];
  mask: number;
  points?: any[];
}) {
  // Default is illustrative only. Session layout snapshots override these coordinates.
  const fallback = [
    [32, 28],
    [65, 28],
    [30, 112],
    [67, 112],
    [22, 196],
    [48, 206],
    [76, 193],
    [25, 248],
  ];
  const coords =
    points?.length === 8
      ? points.map((p) => [Number(p.x_mm), Number(p.y_mm)])
      : fallback;
  return (
    <View style={s.foot}>
      <Text style={s.h2}>{side === "left" ? "Trái" : "Phải"}</Text>
      <Svg width={120} height={255} viewBox="0 0 100 275">
        <Path
          d="M30 267 C4 245 14 214 18 185 C24 149 6 123 8 86 C5 47 14 5 43 4 C68 -2 94 36 94 72 C98 111 82 145 76 180 C72 220 88 250 66 266 Z"
          fill={colors.soft}
          stroke="#cddedb"
        />
        {coords.map(([x, y], i) => {
          const active = !!(mask & (1 << i));
          const normalized = Math.max(0, Math.min(1, (values[i] || 0) / 4095));
          const px = side === "right" ? 100 - x : x,
            py = 270 - y;
          return (
            <React.Fragment key={i}>
              <Circle
                cx={px}
                cy={py}
                r={10}
                fill={
                  active
                    ? `rgb(${Math.round(220 + 35 * normalized)},${Math.round(
                        230 - 160 * normalized,
                      )},${Math.round(220 - 170 * normalized)})`
                    : "#b4bebe"
                }
              />
              <SvgText
                x={px}
                y={py + 3}
                fontSize={9}
                textAnchor="middle"
                fill={colors.ink}
              >
                {i + 1}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      <Text style={s.muted}>ADC tương đối</Text>
    </View>
  );
}
