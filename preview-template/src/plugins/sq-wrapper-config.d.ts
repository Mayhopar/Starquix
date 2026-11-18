// Type surface for sq-wrapper-config.js.
export interface WrapperConfigOptions {
  bridgeJsPathSrc: string;
  prelude?: string;
}
export const SQ_BRIDGE_JS_PATH_SRC: string;
export const SQ_PRELUDE: string;
export function renderWrapperConfig(
  userConfigPath: string,
  sqPluginPath: string,
  componentViewPath: string,
  postViewPath: string,
  opts: WrapperConfigOptions,
): string;
