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
config.resolver.resolveRequest = (context, moduleName, platform) =>
  (resolveRequest ?? context.resolveRequest)(
    context,
    moduleName === parser ? "@formatjs/icu-messageformat-parser/no-parser.js" : moduleName,
    platform,
  );

module.exports = config;
