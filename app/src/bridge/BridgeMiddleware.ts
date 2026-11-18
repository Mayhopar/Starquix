/**
 * Bridge Middleware
 *
 * Injects the IFrameBridge script into HTML responses from the dev server.
 * This enables the design editor to communicate with the iframe content.
 */

import { IFRAME_BRIDGE_SCRIPT } from './IFrameBridgeScript';

export interface BridgeMiddlewareOptions {
  bridgeScript?: string;
}

/**
 * Creates HTML content with the bridge script injected.
 * Can be used as middleware or as a transform function.
 */
export function injectBridgeScript(html: string, options?: BridgeMiddlewareOptions): string {
  const bridgeScript = options?.bridgeScript || IFRAME_BRIDGE_SCRIPT;

  // Check if already injected
  if (html.includes('__SQ_BRIDGE__')) {
    console.log('[BridgeMiddleware] Bridge already present');
    return html;
  }

  // Build script tag - use string concatenation to avoid template literal issues
  const scriptClose = '</' + 'script>';
  const injection = '<script>' + bridgeScript + scriptClose;

  // Inject before </head> or at the start
  if (html.includes('</head>')) {
    return html.replace('</head>', injection + '</head>');
  } else if (html.includes('<head>')) {
    return html.replace('<head>', '<head>' + injection);
  } else if (html.includes('<body>')) {
    return html.replace('<body>', '<body>' + injection);
  } else {
    return injection + html;
  }
}
