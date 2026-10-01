import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Explicit version: eslint-plugin-react's "detect" calls context.getFilename(), removed in ESLint 10.
    settings: { react: { version: "19.3" } },
    rules: {
      // The map code deliberately syncs props into refs during render and resets state in effects
      // (see the comments at each site); React Compiler's stricter rules are advisory here.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // Loosely-typed GeoJSON/ArcGIS payloads
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "test-results/**", "playwright-report/**", "next-env.d.ts"]),
]);
