import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import App from "../App";
import { Button } from "../src/ui/components";
test("native login and explicit offline simulation render without a backend", async () => {
  jest.useFakeTimers();
  let root!: Renderer.ReactTestRenderer;
  await act(async () => {
    root = Renderer.create(<App />);
  });
  const text = () =>
    root.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .flat()
      .join(" ");
  expect(text()).toContain("Đăng nhập");
  expect(text()).toContain("Email");
  const demo = root.root
    .findAllByType(Button)
    .find((n) => n.props.title === "Thử mô phỏng không cần tài khoản")!;
  await act(async () => {
    await demo.props.onPress();
    jest.advanceTimersByTime(200);
  });
  expect(text()).toContain("DỮ LIỆU MÔ PHỎNG");
  expect(text()).toContain("Cảm biến");
  await act(async () => {
    root.unmount();
  });
  jest.clearAllTimers();
  jest.useRealTimers();
});
