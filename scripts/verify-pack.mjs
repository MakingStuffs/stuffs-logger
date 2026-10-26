import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packs every publishable package and audits the tarball npm would receive.
 *
 * A workspace hides publishing bugs: in here `@stuffs/logger-core` resolves to
 * TypeScript source, `workspace:*` resolves to a symlink, and `dist/` may be
 * left over from a build three commits ago. None of that survives contact with
 * a registry. The only honest way to know what a consumer gets is to build the
 * tarball and read it, which is what this does — no publish, no network.
 *
 * Run it before trusting a release:
 *
 *     pnpm release:verify-pack
 *
 * It exits non-zero on the first package that fails, so it is safe to wire
 * straight into CI as a gate.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Packages that go to the public registry. The dashboard is not one of them. */
const PUBLISHABLE_PACKAGES = ["packages/logger-core", "packages/logger-sdk"];

/** npm metadata a published package is expected to carry. */
const REQUIRED_METADATA_FIELDS = [
  "description",
  "keywords",
  "license",
  "author",
  "homepage",
  "repository",
  "bugs",
  "engines",
];

/**
 * Declaration files are the one flavour of `.ts` allowed in a tarball; raw
 * source is not, because a consumer cannot run it.
 *
 * A PACKAGING CHECK, NOT A CONFIDENTIALITY ONE. Both tarballs do carry their
 * TypeScript source, inside the `sourcesContent` of the emitted `.map` files —
 * deliberately, because it is what makes a stack trace in a consuming
 * application point at a real line, and the source is MIT and public anyway.
 * What this rejects is a `.ts` file sitting at an entry point, which is a
 * build that did not run.
 */
const DECLARATION_SUFFIXES = [".d.ts", ".d.cts", ".d.mts"];

/**
 * Everything a tarball may contain, and nothing else.
 *
 * Both manifests declare `"files": ["dist", "README.md", "LICENSE"]` and npm
 * always adds `package.json`. Anything beyond that set — a `scripts/`
 * directory, a `.env` that escaped the ignore rules, a `src/` tree, a build
 * artefact written somewhere new — means the allowlist was widened or npm's
 * own inclusion rules changed, and a published tarball cannot be recalled.
 */
const ALLOWED_TARBALL_FILES = ["package.json", "README.md", "LICENSE"];
const ALLOWED_TARBALL_PREFIX = "dist/";

/**
 * Whether a tarball path is one the package is meant to ship.
 *
 * @param {string} file - A path relative to the tarball root.
 * @returns {boolean}
 */
function isAllowedTarballFile(file) {
  return (
    ALLOWED_TARBALL_FILES.includes(file) ||
    file.startsWith(ALLOWED_TARBALL_PREFIX)
  );
}

/**
 * Whether a source map `sources` entry (or `sourceRoot`) is relative.
 *
 * tsup writes sources relative to the map — `../src/index.ts`,
 * `../../logger-core/src/json.ts` — which is what lets a consumer's debugger
 * pair them with the embedded `sourcesContent`. An absolute path
 * (`/Users/<name>/Dev/…`, `C:\…`) or a URL (`file:///…`, `webpack://…`) would
 * both leak the publishing machine's directory layout into every consumer's
 * `node_modules` and point at a file no consumer has.
 *
 * @param {unknown} source
 * @returns {boolean}
 */
function isRelativeSource(source) {
  if (typeof source !== "string") return false;
  if (source.startsWith("/") || source.startsWith("\\")) return false;

  // A scheme (`file:`, `webpack:`) or a Windows drive letter (`C:`).
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source);
}

/**
 * Lists every file in a directory tree, as paths relative to it.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
function listFiles(dir, prefix = "") {
  return readdirSync(dir).flatMap((entry) => {
    const absolute = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    return statSync(absolute).isDirectory()
      ? listFiles(absolute, relative)
      : [relative];
  });
}

/**
 * Collects every file path an `exports` map points at.
 *
 * Conditions nest arbitrarily deep and a package can silently advertise a
 * condition whose target was never built, so the map is walked rather than
 * spot-checked.
 *
 * @param {unknown} node - An `exports` map, or a subtree of one.
 * @param {string} [conditionPath] - Human-readable trail to the current node.
 * @returns {{ condition: string, target: string }[]}
 */
function collectExportTargets(node, conditionPath = "exports") {
  if (typeof node === "string") {
    return [{ condition: conditionPath, target: node }];
  }
  if (node === null || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) =>
      collectExportTargets(entry, `${conditionPath}[${index}]`),
    );
  }
  return Object.entries(node).flatMap(([key, value]) =>
    collectExportTargets(value, `${conditionPath} → ${key}`),
  );
}

/**
 * Packs one package into `destination` and unpacks it.
 *
 * @param {string} packageDir - Absolute path to the package.
 * @param {string} destination - Absolute path to a scratch directory.
 * @returns {{ tarball: string, contentsDir: string }}
 */
function packAndExtract(packageDir, destination) {
  const output = execFileSync(
    "pnpm",
    ["pack", "--pack-destination", destination],
    { cwd: packageDir, encoding: "utf8", env: { ...process.env, CI: "true" } },
  );

  const tarball = output
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.endsWith(".tgz"));

  if (tarball === undefined || !existsSync(tarball)) {
    throw new Error(`pnpm pack did not report a tarball for ${packageDir}`);
  }

  execFileSync("tar", ["-xzf", tarball, "-C", destination]);
  return { tarball, contentsDir: join(destination, "package") };
}

/**
 * Audits one packed package.
 *
 * @param {string} relativePackageDir
 * @param {string} expectedVersion - The lockstep version from the repo root.
 * @param {string} scratchRoot
 * @returns {{ name: string, manifest: Record<string, unknown>, contentsDir: string, files: string[], problems: string[] }}
 *   The audit's own result, plus the three pieces `verifyCrossPackageTypes`
 *   reads back out of it.
 */
function verifyPackage(relativePackageDir, expectedVersion, scratchRoot) {
  const destination = mkdtempSync(join(scratchRoot, "pack-"));
  const { tarball, contentsDir } = packAndExtract(
    join(REPO_ROOT, relativePackageDir),
    destination,
  );

  const manifest = JSON.parse(
    readFileSync(join(contentsDir, "package.json"), "utf8"),
  );
  const files = listFiles(contentsDir);
  const problems = [];

  if (manifest.private === true) {
    problems.push(`"private": true — npm would refuse to publish this`);
  }
  if (manifest.publishConfig?.access !== "public") {
    problems.push(
      `publishConfig.access is ${JSON.stringify(manifest.publishConfig?.access)}, expected "public"`,
    );
  }
  if (manifest.version !== expectedVersion) {
    problems.push(
      `version is ${manifest.version}, but the repo root is ${expectedVersion} — versions are not in lockstep`,
    );
  }

  for (const field of REQUIRED_METADATA_FIELDS) {
    if (manifest[field] === undefined) {
      problems.push(`missing npm metadata field "${field}"`);
    }
  }
  if (manifest.repository?.directory === undefined) {
    problems.push(`repository.directory is not set`);
  }
  if (!files.includes("LICENSE")) {
    problems.push(`no LICENSE in the tarball`);
  }
  if (!files.includes("README.md")) {
    problems.push(`no README.md in the tarball`);
  }

  const sourceFiles = files.filter(
    (file) =>
      file.endsWith(".ts") &&
      !DECLARATION_SUFFIXES.some((suffix) => file.endsWith(suffix)),
  );
  if (sourceFiles.length > 0) {
    problems.push(
      `unbuilt TypeScript in the tarball: ${sourceFiles.join(", ")}`,
    );
  }

  const strayFiles = files.filter((file) => !isAllowedTarballFile(file));
  if (strayFiles.length > 0) {
    problems.push(
      `files outside ${ALLOWED_TARBALL_FILES.join(", ")} and ${ALLOWED_TARBALL_PREFIX}**: ${strayFiles.join(", ")}`,
    );
  }

  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  for (const file of sourceMaps) {
    let map;
    try {
      map = JSON.parse(readFileSync(join(contentsDir, file), "utf8"));
    } catch {
      problems.push(`${file} is not a JSON source map`);
      continue;
    }

    const sources = Array.isArray(map.sources) ? map.sources : [];
    const nonRelative = sources.filter((source) => !isRelativeSource(source));
    if (nonRelative.length > 0) {
      problems.push(
        `${file} has non-relative sources: ${nonRelative.slice(0, 3).join(", ")}${nonRelative.length > 3 ? `, … (${nonRelative.length} in all)` : ""}`,
      );
    }
    if (
      typeof map.sourceRoot === "string" &&
      map.sourceRoot.length > 0 &&
      !isRelativeSource(map.sourceRoot)
    ) {
      problems.push(`${file} has a non-relative sourceRoot: ${map.sourceRoot}`);
    }
  }

  const entryPoints = [
    ...["main", "module", "types", "browser", "unpkg"]
      .filter((field) => typeof manifest[field] === "string")
      .map((field) => ({ condition: field, target: manifest[field] })),
    ...collectExportTargets(manifest.exports),
  ];

  for (const { condition, target } of entryPoints) {
    if (target.endsWith(".ts") && !target.endsWith(".d.ts")) {
      problems.push(`${condition} points at TypeScript source: ${target}`);
    }
    if (!existsSync(join(contentsDir, target))) {
      problems.push(
        `${condition} points at ${target}, which is not in the tarball`,
      );
    }
  }

  for (const [dependency, range] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    if (!dependency.startsWith("@stuffs/")) continue;
    if (range !== expectedVersion) {
      problems.push(
        `${dependency} is "${range}" — expected the exact lockstep version "${expectedVersion}"`,
      );
    }
  }

  console.log(`\n${manifest.name}@${manifest.version}`);
  console.log(`  tarball    ${tarball}`);
  console.log(
    `  files      ${files.length}, all under ${ALLOWED_TARBALL_PREFIX} or in ${ALLOWED_TARBALL_FILES.join("/")}`,
  );
  console.log(`  maps       ${sourceMaps.length} checked for relative sources`);
  console.log(`  entries    ${entryPoints.length} checked`);
  for (const { condition, target } of entryPoints) {
    console.log(`    ${condition} → ${target}`);
  }
  for (const [dependency, range] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    console.log(`  dependency ${dependency}@${range}`);
  }

  return { name: manifest.name, manifest, contentsDir, files, problems };
}

/**
 * Checks that every workspace specifier one tarball's declarations import is a
 * subpath another tarball actually exports.
 *
 * The SDK bundles the core's *code* in, but its emitted `.d.ts` still re-exports
 * types from `@stuffs/logger-core/taxonomy`, `/redaction` and `/json` — the leaf
 * modules the SDK imports to stay clear of zod. Those specifiers resolve inside
 * this workspace through a tsconfig path mapping that no consumer has. If the
 * core's published `exports` map does not carry the same subpaths, the SDK's
 * public types silently degrade to `any` in every consuming project, and
 * nothing in either package's own tarball would show it.
 *
 * @param {{ name: string, manifest: Record<string, unknown>, contentsDir: string, files: string[], problems: string[] }[]} packages
 */
function verifyCrossPackageTypes(packages) {
  const exportedSubpaths = new Map(
    packages.map(({ name, manifest }) => [
      name,
      new Set(Object.keys(manifest.exports ?? {})),
    ]),
  );

  const specifierPattern = /(?:from|import)\s+["'](@stuffs\/[^"']+)["']/g;

  for (const { name, contentsDir, files, problems } of packages) {
    const declarations = files.filter((file) =>
      DECLARATION_SUFFIXES.some((suffix) => file.endsWith(suffix)),
    );

    const referenced = new Set();
    for (const file of declarations) {
      const contents = readFileSync(join(contentsDir, file), "utf8");
      for (const [, specifier] of contents.matchAll(specifierPattern)) {
        referenced.add(specifier);
      }
    }

    for (const specifier of [...referenced].sort()) {
      const [scope, packageName, ...rest] = specifier.split("/");
      const referencedPackage = `${scope}/${packageName}`;
      const subpath = rest.length === 0 ? "." : `./${rest.join("/")}`;

      const subpaths = exportedSubpaths.get(referencedPackage);
      if (subpaths === undefined) {
        problems.push(
          `declarations import "${specifier}", from a package this script does not pack — cannot verify it resolves`,
        );
        continue;
      }
      if (!subpaths.has(subpath)) {
        problems.push(
          `declarations import "${specifier}", but ${referencedPackage} does not export "${subpath}"`,
        );
        continue;
      }
      console.log(`  types      ${name} → ${specifier} (resolves)`);
    }
  }
}

const scratchRoot = mkdtempSync(join(tmpdir(), "stuffs-logger-verify-"));

try {
  const { version } = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );

  const results = PUBLISHABLE_PACKAGES.map((packageDir) =>
    verifyPackage(packageDir, version, scratchRoot),
  );

  console.log("");
  verifyCrossPackageTypes(results);

  const failed = results.filter(({ problems }) => problems.length > 0);

  console.log("");
  for (const { name, problems } of failed) {
    for (const problem of problems) {
      console.error(`✗ ${name}: ${problem}`);
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      `✓ ${results.length} package(s) pack cleanly at version ${version}`,
    );
  }
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}
