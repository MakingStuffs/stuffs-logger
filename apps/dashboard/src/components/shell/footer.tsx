/**
 * The footer, and the last thing on every page.
 *
 * Says which build is on screen, because the first question about a log
 * viewer behaving oddly is always "which version am I looking at?". Nothing
 * else: a footer full of links on an internal tool is a footer nobody reads.
 *
 * @param appName - The product's name.
 * @param appVersion - The running build's version.
 * @example
 * <Footer appName="Stuffs Logger" appVersion="0.1.0" />
 */
export function Footer({
  appName,
  appVersion,
}: {
  appName: string;
  appVersion: string;
}) {
  return (
    <footer className="mt-auto border-t px-6 py-4">
      <p className="text-muted-foreground text-center text-xs">
        {appName} v{appVersion} · Self-hosted logging for Making Stuffs
      </p>
    </footer>
  );
}
