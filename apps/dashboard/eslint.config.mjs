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
    ],
  },
  ...next,
  ...nextCoreWebVitals,
];

export default config;
