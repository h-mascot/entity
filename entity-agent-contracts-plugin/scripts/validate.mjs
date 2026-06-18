import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const manifest = readJson("entity.plugin.json");
const contracts = readJson("contracts/agent-contracts.v1.json");
const sources = readJson("contracts/source-registry.v1.json");

const requiredManifestFields = [
  "id",
  "name",
  "version",
  "kind",
  "description",
  "entityVersion",
  "capabilities",
];

for (const field of requiredManifestFields) {
  if (!(field in manifest)) {
    throw new Error(`manifest missing required field: ${field}`);
  }
}

if (manifest.id !== "entity-agent-contracts") {
  throw new Error("unexpected manifest id");
}

if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
  throw new Error("manifest capabilities must be a non-empty array");
}

if (!Array.isArray(contracts.contracts) || contracts.contracts.length < 5) {
  throw new Error("agent contracts manifest must include the required contract set");
}

for (const id of [
  "document-link-delivery",
  "source-registry",
  "entity-source-of-truth",
  "mission-control-completion",
  "openclaw-config-safety",
]) {
  if (!contracts.contracts.some((contract) => contract.id === id)) {
    throw new Error(`agent contracts manifest missing ${id}`);
  }
}

if (!Array.isArray(sources.sources) || sources.sources.length === 0) {
  throw new Error("source registry must include at least one source");
}

const sourceIds = new Set(sources.sources.map((source) => source.sourceId));
for (const id of ["ada-gateway", "ada", "vault", "spock", "midas", "scotty", "zora", "book", "geordi"]) {
  if (!sourceIds.has(id)) {
    throw new Error(`source registry missing ${id}`);
  }
}

console.log("entity-agent-contracts-plugin validation passed");
