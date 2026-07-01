export function shouldRegisterTestErrorRoute(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production';
}
