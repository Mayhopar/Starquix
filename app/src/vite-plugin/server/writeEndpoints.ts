/**
 * Source write endpoints: WS handlers (editor HMR relay) + HTTP POST
 * fallbacks (local projects without the relay) for class/text/image writes
 * and element reorder. Moved verbatim from vite-plugin/index.ts.
 */
import {
  updateClassAttribute,
  updateTextContent,
  updateImageAttribute,
  reorderElements,
  type SourceLocation,
} from '../ast-updater';
import type { SqServerContext } from './context';

export function registerWriteEndpoints(ctx: SqServerContext): void {
  const { server, executeFileWrite, resolveFilePath, readJsonBody, sendWsResult, sendHttpResult } = ctx;

  // Handle write requests from editor
  server.ws.on('sq:write-classes', async (data: {
    sourceLocation: SourceLocation; newClasses: string; baseClasses?: string; requestId: string;
  }) => {
    const { sourceLocation, newClasses, baseClasses, requestId } = data;
    const filePath = resolveFilePath(sourceLocation.file);
    try {
      // baseClasses = what the file renders for this element; the writer needs
      // it to keep a dynamic expression's tokens out of a leading literal
      // (task-166). Absent → the partial shapes refuse instead of corrupting.
      await executeFileWrite(filePath, (c) => updateClassAttribute(c, filePath, sourceLocation, newClasses, baseClasses));
      sendWsResult('sq:write-result', requestId, true);
      console.log('[sq-source] Wrote class update to:', filePath);
    } catch (error) {
      sendWsResult('sq:write-result', requestId, false, error);
      console.error('[sq-source] Failed to write class update:', error);
    }
  });

  // Handle text content updates
  server.ws.on('sq:write-text', async (data: {
    sourceLocation: SourceLocation; newText: string; requestId: string;
  }) => {
    const { sourceLocation, newText, requestId } = data;
    const filePath = resolveFilePath(sourceLocation.file);
    try {
      await executeFileWrite(filePath, (c) => updateTextContent(c, filePath, sourceLocation, newText));
      sendWsResult('sq:write-text-result', requestId, true);
      console.log('[sq-source] Wrote text content to:', filePath);
    } catch (error) {
      sendWsResult('sq:write-text-result', requestId, false, error);
      console.error('[sq-source] Text write error:', error);
    }
  });

  // Handle image attribute updates (src, alt, loading)
  server.ws.on('sq:write-image', async (data: {
    sourceLocation: SourceLocation; attribute: 'src' | 'alt' | 'loading'; newValue: string; requestId: string;
  }) => {
    const { sourceLocation, attribute, newValue, requestId } = data;
    const filePath = resolveFilePath(sourceLocation.file);
    try {
      await executeFileWrite(filePath, (c) => updateImageAttribute(c, filePath, sourceLocation, attribute, newValue));
      sendWsResult('sq:write-image-result', requestId, true);
      console.log('[sq-source] Wrote image attribute update to:', filePath);
    } catch (error) {
      sendWsResult('sq:write-image-result', requestId, false, error);
      console.error('[sq-source] Image attribute write error:', error);
    }
  });

  // Handle reorder requests from editor (for drag-and-drop in ElementsTree)
  server.ws.on('sq:reorder-elements', async (data: {
    filePath: string; locations: SourceLocation[]; newOrder: number[]; requestId: string;
  }) => {
    const { filePath, locations, newOrder, requestId } = data;
    const absolutePath = resolveFilePath(filePath);
    try {
      await executeFileWrite(absolutePath, (c) => reorderElements(c, locations, newOrder));
      sendWsResult('sq:write-result', requestId, true);
      console.log('[sq-source] Reordered elements in:', absolutePath);
    } catch (error) {
      sendWsResult('sq:write-result', requestId, false, error);
      console.error('[sq-source] Failed to reorder elements:', error);
    }
  });

  // --- HTTP POST write endpoints (for local projects without HMR relay) ---

  // POST /__sq/write-classes
  server.middlewares.use('/__sq/write-classes', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const { sourceLocation, newClasses, baseClasses, projectRoot: bodyRoot } = (await readJsonBody(req)) as {
        sourceLocation: SourceLocation; newClasses: string; baseClasses?: string; projectRoot?: string;
      };
      const filePath = resolveFilePath(sourceLocation.file, bodyRoot);
      await executeFileWrite(filePath, (c) => updateClassAttribute(c, filePath, sourceLocation, newClasses, baseClasses));
      console.log('[sq-source] HTTP wrote class update to:', filePath);
      sendHttpResult(res, true);
    } catch (error) {
      console.error('[sq-source] HTTP class write error:', error);
      sendHttpResult(res, false, error);
    }
  });

  // POST /__sq/write-text
  server.middlewares.use('/__sq/write-text', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const { sourceLocation, newText, projectRoot: bodyRoot } = (await readJsonBody(req)) as {
        sourceLocation: SourceLocation; newText: string; projectRoot?: string;
      };
      const filePath = resolveFilePath(sourceLocation.file, bodyRoot);
      await executeFileWrite(filePath, (c) => updateTextContent(c, filePath, sourceLocation, newText));
      console.log('[sq-source] HTTP wrote text update to:', filePath);
      sendHttpResult(res, true);
    } catch (error) {
      console.error('[sq-source] HTTP text write error:', error);
      sendHttpResult(res, false, error);
    }
  });

  // POST /__sq/write-image
  server.middlewares.use('/__sq/write-image', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      const { sourceLocation, attribute, newValue, projectRoot: bodyRoot } = (await readJsonBody(req)) as {
        sourceLocation: SourceLocation; attribute: 'src' | 'alt' | 'loading'; newValue: string; projectRoot?: string;
      };
      const filePath = resolveFilePath(sourceLocation.file, bodyRoot);
      await executeFileWrite(filePath, (c) => updateImageAttribute(c, filePath, sourceLocation, attribute, newValue));
      console.log('[sq-source] HTTP wrote image attribute update to:', filePath);
      sendHttpResult(res, true);
    } catch (error) {
      console.error('[sq-source] HTTP image write error:', error);
      sendHttpResult(res, false, error);
    }
  });
}
