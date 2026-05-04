let runtime = null;

export function setDiscordRuntime(next) {
  runtime = next;
}

export function getDiscordRuntime() {
  if (!runtime) {
    throw new Error("Discord runtime not initialized");
  }
  return runtime;
}
