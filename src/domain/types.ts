export type Side = "left" | "right";
export type LinkState =
  | "DISCONNECTED"
  | "SCANNING"
  | "CONNECTING"
  | "CONNECTED"
  | "STREAMING"
  | "DISCONNECTING"
  | "ERROR";
export type SensorFrame = {
  sequence_no: number;
  device_time_us: number;
  fsr: number[];
  fsr_filtered: number[];
  filter_version: string;
  fsr_valid_mask: number;
  quality_flags: number;
  imu: number[] | null;
};
export type DeviceIdentity = {
  v: number;
  device_uid: string;
  side: Side;
  boot_id: string;
  nonce: string;
  receipt?: string;
  next_sequence: number;
  first_sequence: number;
  last_sequence: number;
  session_id: string;
  recording: boolean;
  pending: number;
  firmware_version: string;
  protocol_version: string;
  battery_percent: number | null;
  dropped_samples: number;
};
export type Pair = {
  pair_uid: string;
  display_name: string;
  source: string;
  devices: {
    device_uid: string;
    side: Side;
    hardware_version: string;
    firmware_version: string | null;
    last_battery_percent: number | null;
    last_seen_at: string | null;
  }[];
};
export type Session = {
  id: string;
  status: string;
  activity: string;
  transport: string;
  started_at: string | null;
  ended_at: string | null;
  display_name?: string;
  streams?: any[];
  snapshots?: any[];
  metrics?: any[];
  runs?: any[];
  reasons?: string[];
  [key: string]: any;
};
export type LocalStream = {
  uid: string;
  side: Side;
  bleId: string;
  bootId: string;
  streamId: string;
  first: number;
  last?: number;
  closed?: boolean;
};
export type LocalCapture = {
  id: string;
  owner: string;
  server: string;
  state: "recording" | "stopped" | "interrupted" | "synced";
  streams: LocalStream[];
  startedAt: number;
  error?: string;
};
export type SensorView = {
  raw: number[];
  filtered: (number | null)[];
  mask: number;
  flags: number;
  trace: {
    raw: number;
    filtered: number | null;
    channels?: number[];
    filteredChannels?: number[];
  }[];
  count: number;
  gaps: number;
  duplicates: number;
  time: number;
};
