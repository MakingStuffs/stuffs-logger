import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      // Playwright output. `playwright-report/` in particular contains the
      // bundled trace viewer — minified third-party React that trips every
      // hook rule in the config and is not ours to fix.
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      // One signed-in storage state per role plus the seed manifest, written
      // by the setup projects on every run.
      "e2e/.state/**",
    ],
  },
  ...next,
  ...nextCoreWebVitals,
];

export default config;
