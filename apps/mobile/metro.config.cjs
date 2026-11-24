const { join, resolve } = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const workspaceRoot = resolve(__dirname, "../..");
const workspaceModules = join(workspaceRoot, "node_modules");
const config = getDefaultConfig(__dirname);

// Metro follows Bun's symlinks when their workspace and store targets are watched.
config.watchFolders = [join(workspaceRoot, "packages"), workspaceModules];
config.resolver.nodeModulesPaths = [join(__dirname, "node_modules"), workspaceModules];

const parser = "@formatjs/icu-messageformat-parser";
const resolveRequest = config.resolver.resolveRequest;
const localWeb = process.env.EXPO_PUBLIC_BOOKBUDDY_LOCAL_WEB === "1";
config.resolver.resolveRequest = (context, moduleName, platform) => {
  let target = moduleName;
  if (moduleName === parser) target = "@formatjs/icu-messageformat-parser/no-parser.js";
  // Only explicitly local exports run the real app routes on web.
  if (localWeb && platform === "web" && moduleName === "./src/entry" && context.originModulePath === join(__dirname, "index.ts")) {
    target = "expo-router/entry";
  }
  return (resolveRequest ?? context.resolveRequest)(context, target, platform);
};

module.exports = config;
