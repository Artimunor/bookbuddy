const fs = require("node:fs/promises");
const path = require("node:path");
const { createRunOncePlugin, withXcodeProject } = require("expo/config-plugins");

const targetName = "BookBuddyStatusWidget";
const sources = ["StatusCardWidget.swift", "StatusCardAttributes.swift"];

function settingsFor(project, target) {
  const configurations = project.pbxXCConfigurationList()[target.buildConfigurationList].buildConfigurations;
  const buildSettings = project.pbxXCBuildConfigurationSection();
  return configurations.map(({ value }) => buildSettings[value]);
}

function withLiveActivities(config) {
  const appId = config.ios?.bundleIdentifier;
  if (!appId) throw new Error("Live Activities require ios.bundleIdentifier");
  const bundleIdentifier = `${appId}.status-widget`;
  const extra = (config.extra ??= {});
  const eas = (extra.eas ??= {});
  const build = (eas.build ??= {});
  const experimental = (build.experimental ??= {});
  const ios = (experimental.ios ??= {});
  const extensions = (ios.appExtensions ??= []);
  if (!extensions.some((extension) => extension.targetName === targetName)) extensions.push({ targetName, bundleIdentifier });

  config.ios.infoPlist = { ...config.ios.infoPlist, NSSupportsLiveActivities: true };

  return withXcodeProject(config, async (config) => {
    const { modResults: project, modRequest } = config;
    const directory = path.join(modRequest.platformProjectRoot, targetName);
    await fs.mkdir(directory, { recursive: true });
    await Promise.all([
      fs.copyFile(path.join(__dirname, "widget", sources[0]), path.join(directory, sources[0])),
      fs.copyFile(path.join(__dirname, "widget", "Info.plist"), path.join(directory, "Info.plist")),
      fs.copyFile(path.join(__dirname, "../../modules/status-cards/ios", sources[1]), path.join(directory, sources[1])),
    ]);
    const application = project.getFirstTarget();
    let target = project.pbxTargetByName(targetName);
    if (!target) {
      // xcode's app_extension target is embedded in PlugIns and added as a host dependency.
      const created = project.addTarget(targetName, "app_extension", targetName, bundleIdentifier);
      target = created.pbxNativeTarget;
      const group = project.addPbxGroup([], targetName, targetName);
      const root = project.getFirstProject().firstProject.mainGroup;
      project.hash.project.objects.PBXGroup[root].children.push({ value: group.uuid, comment: targetName });
      project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", created.uuid);
      project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", created.uuid);
      for (const file of sources) project.addSourceFile(file, { target: created.uuid }, group.uuid);
      project.addFile("Info.plist", group.uuid);
      const product = project.pbxBuildFileSection();
      for (const file of Object.values(product)) {
        if (file?.fileRef === target.productReference) file.settings = { ATTRIBUTES: ["RemoveHeadersOnCopy"] };
      }
    }
    const applicationSettings = settingsFor(project, application.firstTarget);
    for (const { name, buildSettings } of settingsFor(project, target)) {
      const app = applicationSettings.find((candidate) => candidate.name === name)?.buildSettings ?? {};
      const deployment = String(app.IPHONEOS_DEPLOYMENT_TARGET ?? "16.2").replaceAll('"', "");
      const [major, minor = 0] = deployment.split(".").map(Number);
      Object.assign(buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: app.CURRENT_PROJECT_VERSION ?? config.ios?.buildNumber ?? "1",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `"${targetName}/Info.plist"`,
        IPHONEOS_DEPLOYMENT_TARGET: major > 16 || (major === 16 && minor >= 2) ? deployment : "16.2",
        MARKETING_VERSION: app.MARKETING_VERSION ?? config.version ?? "1.0.0",
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
        SDKROOT: "iphoneos",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: app.TARGETED_DEVICE_FAMILY ?? '"1,2"',
        ...(app.DEVELOPMENT_TEAM || config.ios?.appleTeamId ? { DEVELOPMENT_TEAM: app.DEVELOPMENT_TEAM || config.ios.appleTeamId } : {}),
      });
    }
    return config;
  });
}

module.exports = createRunOncePlugin(withLiveActivities, "bookbuddy-live-activities", "1.0.0");
