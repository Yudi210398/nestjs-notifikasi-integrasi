module.exports = {
  rootDir: "src",
  testMatch: ["**/*.spec.ts"],
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json", "ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  coverageDirectory: "../coverage",
};
