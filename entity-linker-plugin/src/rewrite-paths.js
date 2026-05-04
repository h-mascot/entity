export const ENTITY_OUTPUT_BASE_URL = "http://100.106.69.9:3000/output/";

const LOCAL_OUTPUT_PATH_PATTERN =
  /(?:~\/clawd\/(?:output\/)?|\/home\/henrymascot\/clawd\/(?:output\/)?)([^\s<>()\[\]{}"'`]+)/g;

export function replaceEntityPaths(text) {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }

  return text.replace(LOCAL_OUTPUT_PATH_PATTERN, (_match, relativePath) => {
    const normalizedPath = String(relativePath).replace(/^\/+/, "");
    return `${ENTITY_OUTPUT_BASE_URL}${normalizedPath}`;
  });
}
