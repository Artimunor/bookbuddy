const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/** @typedef {Record<string, { dir: "ltr" | "rtl" }>} EnabledLocales */

/** @param {string} projectRoot @returns {EnabledLocales} */
function readLocales(projectRoot) {
  const path = resolve(projectRoot, "../../packages/i18n/locales.json");
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { en: { dir: "ltr" }, "pt-PT": { dir: "ltr" } };
  }
  /** @type {{ enabledLocales: EnabledLocales }} */
  const manifest = JSON.parse(source);
  return manifest.enabledLocales;
}

/**
 * @param {string} projectRoot
 * @returns {{ linkHost: string | undefined; supportedLocales: string[]; supportsRTL: boolean }}
 */
exports.readBuildInputs = function readBuildInputs(projectRoot) {
  const locales = readLocales(projectRoot);
  return {
    linkHost: process.env.BOOKBUDDY_LINK_HOST,
    supportedLocales: Object.keys(locales),
    supportsRTL: Object.values(locales).some(({ dir }) => dir === "rtl"),
  };
};
