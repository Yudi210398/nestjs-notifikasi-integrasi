module.exports = {
  rootDir: "src",
  testMatch: ["**/*.integration-spec.ts"],
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json", "ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
};
