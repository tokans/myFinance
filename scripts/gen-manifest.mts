import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MYFINANCE_SCHEMAS } from "../src/db/schemas";

// Regenerate schema.manifest.json from the authoritative descriptor list (db/schemas.ts)
// so publisher-ci's schema-merge gate sees exactly what the app registers at runtime.
writeFileSync(
  join(process.cwd(), "schema.manifest.json"),
  JSON.stringify(MYFINANCE_SCHEMAS, null, 2) + "\n",
);
console.log(`wrote schema.manifest.json with ${MYFINANCE_SCHEMAS.length} descriptors`);
