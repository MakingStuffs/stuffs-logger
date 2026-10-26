/**
 * Server-start checks.
 *
 * Next calls {@link register} once when a server instance starts, before it
 * takes a request, and a thrown error aborts the start
 * (`next/dist/server/lib/router-utils/instrumentation-globals.external.js`,
 * `registerInstrumentation`, which also skips itself during
 * `phase-production-build`). That timing is the point. The check here needs
 * the RUNTIME environment, which `next build` does not have — the build
 * imports every route module with `NODE_ENV=production` and no
 * `BETTER_AUTH_URL` — so it cannot live at module load the way the
 * `SKIP_AUTH` guard in `constants/environment.ts` does.
 *
 * Guarded on the Node runtime because Next calls `register` for every runtime
 * it compiled. Nothing of ours runs on Edge, and an Edge bundle has no server
 * to refuse to start.
 *
 * The import is deferred into the function, per Next's guidance for this
 * file, so nothing is evaluated at the top of it in a runtime that will not
 * use it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionAuthEnvironment } =
    await import("@/constants/environment");

  assertProductionAuthEnvironment(process.env);

  // Not a refusal: running with no proxy in front is legitimate. Forgetting
  // the variable behind one quietly weakens the throttles, so say so once.
  const { proxyTrustWarning } = await import("@/lib/net/client-ip");
  const warning = proxyTrustWarning(process.env);
  if (warning !== null) console.warn(warning);
}
