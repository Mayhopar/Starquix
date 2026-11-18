export async function writeClipboardHtml(html: string, plainText: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboardHtml(): Promise<string | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        return await (await item.getType('text/html')).text();
      }
    }
    return null;
  } catch {
    return null;
  }
}
