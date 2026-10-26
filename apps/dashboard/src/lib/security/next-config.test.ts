import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The response headers and output mode `next.config.ts` declares.
 *
 * Pinned here because they are security controls the smoke suite only sees
 * after a deploy, and because the production-only branches — HSTS above all —
 * never run in a unit test unless the module is loaded under that environment
 * on purpose. The config reads `NODE_ENV` at module load, so each case resets
 * the module registry and imports it afresh.
 */

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/** The path pattern the document-route rule starts with. */
const DOCUMENT_RULE_PREFIX = "/((?!api/v1/ingest)";

/** The ingest endpoint's own rule. */
const INGEST_RULE_SOURCE = "/api/v1/ingest";

async function loadConfig(nodeEnv: "production" | "test") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { default: config } = await import("../../../next.config");

  return config;
}

async function loadHeaderRules(
  nodeEnv: "production" | "test",
): Promise<HeaderRule[]> {
  const config = await loadConfig(nodeEnv);
  if (config.headers === undefined) {
    throw new Error("next.config declares no headers()");
  }

  return config.headers();
}

function ruleFor(rules: HeaderRule[], source: string): HeaderRule {
  const rule = rules.find((candidate) => candidate.source.startsWith(source));
  if (rule === undefined) throw new Error(`no header rule for ${source}`);

  return rule;
}

function headerValue(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find((header) => header.key === key)?.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config headers", () => {
  it("sends HSTS on documents in production, without the preload directive", async () => {
    const rules = await loadHeaderRules("production");

    // `preload` is a commitment an operator makes by submitting their domain
    // to the browser preload list; a default that claims it on their behalf
    // is a claim about a registration that was never made.
    expect(
      headerValue(
        ruleFor(rules, DOCUMENT_RULE_PREFIX),
        "Strict-Transport-Security",
      ),
    ).toBe("max-age=63072000; includeSubDomains");
  });

  it("sends HSTS on the ingest endpoint in production too", async () => {
    const rules = await loadHeaderRules("production");
    const ingest = ruleFor(rules, INGEST_RULE_SOURCE);

    expect(headerValue(ingest, "Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(headerValue(ingest, "X-Content-Type-Options")).toBe("nosniff");
  });

  it("never pins a development host to HTTPS", async () => {
    const rules = await loadHeaderRules("test");

    for (const rule of rules) {
      expect(headerValue(rule, "Strict-Transport-Security")).toBeUndefined();
    }
  });

  it("names the current Permissions-Policy feature for interest-based ads", async () => {
    const rules = await loadHeaderRules("test");
    const policy = headerValue(
      ruleFor(rules, DOCUMENT_RULE_PREFIX),
      "Permissions-Policy",
    );

    expect(policy).toContain("browsing-topics=()");
    expect(policy).not.toContain("interest-cohort");
  });

  it("keeps framing refused on every document", async () => {
    const rules = await loadHeaderRules("production");
    const documents = ruleFor(rules, DOCUMENT_RULE_PREFIX);

    expect(headerValue(documents, "Content-Security-Policy")).toBe(
      "frame-ancestors 'none'",
    );
    expect(headerValue(documents, "X-Frame-Options")).toBe("DENY");
  });
});

describe("next.config output", () => {
  it("builds the standalone server a plain-Node host runs", async () => {
    const config = await loadConfig("test");

    expect(config.output).toBe("standalone");
  });
});
