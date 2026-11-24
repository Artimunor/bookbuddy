const { withAppDelegate } = require("expo/config-plugins");

const marker = "// @bookbuddy/offline-directory";

module.exports = function withOfflineDirectory(config) {
  return withAppDelegate(config, (config) => {
    const delegate = config.modResults;
    if (delegate.language !== "swift") throw new Error("BookBuddy requires a Swift AppDelegate");
    if (delegate.contents.includes(marker)) return config;
    const entry = /(func application\([\s\S]+?didFinishLaunchingWithOptions[\s\S]+?\) -> Bool \{)/;
    if (!entry.test(delegate.contents)) throw new Error("Could not configure the private offline directory");
    delegate.contents = `import Foundation\n${delegate.contents}`.replace(entry, `$1
    ${marker}
    if var directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("BookBuddyOffline", isDirectory: true) {
      let ready = directory.appendingPathComponent(".no-backup")
      try? FileManager.default.removeItem(at: ready)
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var protection = URLResourceValues()
        protection.isExcludedFromBackup = true
        try directory.setResourceValues(protection)
        try Data().write(to: ready, options: .atomic)
      } catch {
        // JavaScript will not open the store without this marker.
      }
    }
`);
    return config;
  });
};
