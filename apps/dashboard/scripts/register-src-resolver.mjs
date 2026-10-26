import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Lets plain Node run this app's TypeScript sources, with no new dependency.
 *
 * Node strips TypeScript types natively (`--experimental-strip-types`, on by
 * default from Node 23.6 / 22.18), but it resolves modules the way Node does,
 * not the way this app's bundler does. The sources use two bundler
 * conventions Node does not know:
 *
 * - the `@/` alias for `src/` (`tsconfig.json` `paths`), and
 * - extensionless relative imports (`./types` meaning `./types.ts`).
 *
 * This hook teaches Node exactly those two things and nothing else, so a
 * script can import the same `src/lib` modules the app runs — one copy of
 * the user-creation logic, not a second one written for the command line.
 *
 * Synchronous in-thread hooks (`module.registerHooks`, Node 22.15+), loaded
 * with `--import` before the script itself.
 */

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

/** Extensions tried, in order, for an extensionless import. */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** The first existing file a bundler-style path would resolve to. */
function resolveFile(path) {
  if (isFile(path)) return path;

  for (const suffix of CANDIDATE_SUFFIXES) {
    if (isFile(`${path}${suffix}`)) return `${path}${suffix}`;
  }

  return null;
}

/** Whether a URL is one of this app's own `.ts` files. */
function isAppTypeScript(url) {
  return (
    url.startsWith("file:") &&
    url.endsWith(".ts") &&
    !url.includes("/node_modules/")
  );
}

/** Whether a resolution starts from this app's own sources, not a package. */
function isAppParent(parentURL) {
  return (
    parentURL !== undefined &&
    parentURL.startsWith("file:") &&
    !parentURL.includes("/node_modules/")
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const file = resolveFile(`${SRC_DIR}${specifier.slice(2)}`);
      if (file !== null) {
        return nextResolve(pathToFileURL(file).href, context);
      }
    }

    const isRelative =
      specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelative && isAppParent(context.parentURL)) {
      const file = resolveFile(
        fileURLToPath(new URL(specifier, context.parentURL)),
      );
      if (file !== null) {
        return nextResolve(pathToFileURL(file).href, context);
      }
    }

    return nextResolve(specifier, context);
  },

  // Every TypeScript file in this app is an ES module, but the package has no
  // `"type": "module"` (Next does not need one). Saying so here spares Node a
  // failed CommonJS parse — and a warning — for every file it loads.
  load(url, context, nextLoad) {
    if (isAppTypeScript(url)) {
      return nextLoad(url, { ...context, format: "module-typescript" });
    }

    return nextLoad(url, context);
  },
});
