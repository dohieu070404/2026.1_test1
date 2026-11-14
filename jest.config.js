module.exports = {
  preset: "jest-expo",
  testMatch: ["**/test/**/*.test.[jt]s?(x)"],
  setupFilesAfterEnv: ["./test/setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native[^/]*|@react-native[^/]*|expo[^/]*|@expo[^/]*|uuid|react-native-svg)/)",
  ],
};
