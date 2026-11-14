import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const canUseBle = Platform.OS === "android" && !isExpoGo;
export const BLE_BUILD_MESSAGE =
  "Expo Go dùng để chạy giao diện, mô phỏng và API. Để kết nối ESP32 bằng BLE, chạy npm run android:dev để tạo Expo development build.";
