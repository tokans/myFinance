import fs from "node:fs";

const file = process.argv[2] ?? "src/tax/schemas/ITR-1_AY26-27.json";
const s = JSON.parse(fs.readFileSync(file, "utf8"));

console.log("=== top-level ===");
console.log(Object.keys(s).join(", "));

console.log("\n=== ITR property ===");
console.log(JSON.stringify(s.properties.ITR, null, 2).slice(0, 500));

console.log("\n=== definition names ===");
const defs = Object.keys(s.definitions ?? {});
console.log(defs.length, "definitions");
console.log(defs.slice(0, 40).join(", "));

console.log("\n=== top-level form root definition ===");
const formRoot = defs.find((d) => /^ITR\d?$|ITR1Form|ITRForm/i.test(d));
if (formRoot) {
  const root = s.definitions[formRoot];
  console.log("formRoot:", formRoot);
  console.log("properties:", Object.keys(root.properties ?? {}).join(", "));
}
