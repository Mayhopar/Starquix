export async function mutateLayoutProp(
  layoutName: string,
  op: 'add' | 'remove',
  propName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const resp = await fetch('/__sq/layout-prop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layoutName, op, propName }),
    });
    if (resp.ok) return { ok: true };
    const data = await resp.json().catch(() => ({}));
    return { ok: false, error: (data as { error?: string }).error ?? `Request failed (${resp.status})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
