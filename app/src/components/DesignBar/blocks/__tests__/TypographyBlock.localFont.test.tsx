// gap-61 regression: for a local_ project, TypographyBlock's font pick/upload
// must take the FILES-truth path (utils/localFonts → /__sq/local/font-*) and
// never the Dexie path (pickGoogleFont/uploadAsset → Dexie + sq-asset refs).
// Before the fix, the identical Dexie code ran for local_ ids: bytes landed in
// Dexie (banned for local_, task-132), the manifest died with the session doc,
// and the user's real .astro file kept a font-["Family"] class that resolved
// to nothing on reopen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Stub = () => null;
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) mocked[key] = Stub;
  return mocked;
});

const h = vi.hoisted(() => ({
  dispatchSpy: vi.fn(),
  pickLocal: vi.fn(),
  uploadLocal: vi.fn(),
  updateLocal: vi.fn(),
  pickGoogle: vi.fn(),
  uploadAsset: vi.fn(),
  transferAsset: vi.fn(),
  dbGet: vi.fn(),
  projectId: 'browser_lf_testsite',
}));

vi.mock('@/store/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/hooks')>();
  const Y = await import('yjs');
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', 'browser_lf_testsite');
  return {
    ...actual,
    useEditorDoc: () => doc,
    useYjsValue: <T,>(selector: (d: import('yjs').Doc) => T) => { doc.getMap('meta').set('projectId', h.projectId); return selector(doc); },
    useDispatch: () => h.dispatchSpy,
  };
});

vi.mock('@/utils/localFonts', async original => ({
  ...await original<typeof import('@/utils/localFonts')>(),
  pickLocalGoogleFont: h.pickLocal,
  uploadLocalFont: h.uploadLocal,
  updateLocalCustomFont: h.updateLocal,
}));
vi.mock('@/services/googleFonts', () => ({ pickGoogleFont: h.pickGoogle }));
vi.mock('@/hooks/useAssetUpload', () => ({ useAssetUpload: () => ({ uploadAsset: h.uploadAsset }) }));
vi.mock('@/utils/assetTransfer', () => ({ transferAssetToIframe: h.transferAsset }));
vi.mock('@/db', () => ({ db: { assets: { get: h.dbGet } }, getAssetBlob: vi.fn() }));

// The real select needs a full catalog popover; the branch under test only
// needs onChange to fire with a family name.
vi.mock('../FontFamilySelect', () => ({
  FontFamilySelect: ({ onChange, inherited }: { onChange: (v: string) => void; inherited?: string }) => (
    <><span data-testid="inherited">{inherited}</span><button data-testid="pick-font" onClick={() => onChange('Open Sans')} /><button data-testid="system-font" onClick={() => onChange('serif')} /></>
  ),
}));

import { TypographyBlock } from '../TypographyBlock';
import { LOCAL_FONT_NO_HEAD_WARNING } from '@/utils/localFonts';
import { setSiteFonts } from '@/services/siteFonts';

beforeEach(() => {
  vi.clearAllMocks();
  h.projectId = 'browser_lf_testsite';
  setSiteFonts('', []);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.pickLocal.mockResolvedValue({ css: 'LOCAL_CSS', warning: null });
  h.uploadLocal.mockResolvedValue({
    family: 'My Brand', format: 'woff2', srcUrl: '/fonts/My-Brand.woff2', css: 'UP_CSS', warning: null,
  });
});

describe('TypographyBlock local-mode fonts (gap-61)', () => {
  it('google pick goes through the files-truth path, never Dexie/pickGoogleFont', async () => {
    const onClassesChange = vi.fn();
    render(<TypographyBlock classes="" computedStyles={null} onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));

    await waitFor(() => expect(onClassesChange).toHaveBeenCalledWith('font-["Open_Sans"]', expect.any(Function)));
    expect(h.pickLocal).toHaveBeenCalledWith('browser_lf_testsite', 'Open Sans', [400, 500, 700]);
    expect(h.pickGoogle).not.toHaveBeenCalled();
    expect(h.dbGet).not.toHaveBeenCalled();
    expect(h.transferAsset).not.toHaveBeenCalled();
    expect(h.dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_PROJECT_FONT',
      family: 'Open Sans',
      entry: { source: 'google', css: 'LOCAL_CSS', assetIds: [] },
    });
  });

  it('a family the site already loads only writes the class — no download, no stylesheet write', async () => {
    setSiteFonts('browser_lf_testsite', ['Open Sans']);
    const onClassesChange = vi.fn();
    render(<TypographyBlock classes="" computedStyles={null} onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    expect(onClassesChange).toHaveBeenCalledWith('font-["Open_Sans"]', expect.any(Function));
    expect(h.pickLocal).not.toHaveBeenCalled();
    expect(h.pickGoogle).not.toHaveBeenCalled();
    expect(h.dispatchSpy).not.toHaveBeenCalled();
  });

  it('names the inherited family only when the picker lists it', () => {
    setSiteFonts('browser_lf_testsite', ['Brand Sans']);
    const styles = (fontFamily: string) => ({ fontFamily } as never);
    const { rerender } = render(<TypographyBlock classes="" computedStyles={styles('"Brand Sans", sans-serif')} onClassesChange={vi.fn()} />);
    expect(screen.getByTestId('inherited').textContent).toBe('Brand Sans');
    rerender(<TypographyBlock classes="" computedStyles={styles('ui-sans-serif, system-ui, sans-serif')} onClassesChange={vi.fn()} />);
    expect(screen.getByTestId('inherited').textContent).toBe('');
  });

  it('maps the known missing stylesheet warning to neutral appearance guidance', async () => {
    h.pickLocal.mockResolvedValue({ css: 'LOCAL_CSS', warning: LOCAL_FONT_NO_HEAD_WARNING });
    render(<TypographyBlock classes="" computedStyles={null} onClassesChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    expect(await screen.findByRole('status')).toHaveTextContent('Font saved; site appearance may differ');
    expect(screen.queryByText(LOCAL_FONT_NO_HEAD_WARNING)).toBeNull();
  });

  it('custom upload writes the user file, never uploadAsset/Dexie', async () => {
    const onClassesChange = vi.fn();
    const { container } = render(
      <TypographyBlock classes="" computedStyles={null} onClassesChange={onClassesChange} />,
    );
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['F'], 'My-Brand.woff2')] } });

    await waitFor(() => expect(onClassesChange).toHaveBeenCalledWith('font-["My_Brand"]', expect.any(Function)));
    expect(h.uploadLocal).toHaveBeenCalledWith('browser_lf_testsite', expect.any(File));
    expect(h.uploadAsset).not.toHaveBeenCalled();
    expect(h.transferAsset).not.toHaveBeenCalled();
    expect(h.dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_PROJECT_FONT',
      family: 'My Brand',
      entry: { source: 'custom', css: 'UP_CSS', assetIds: [] },
    });
  });

  it('weight rebake for a local upload re-merges via updateLocalCustomFont', async () => {
    h.updateLocal.mockResolvedValue({ css: 'REBAKED' });
    const { container } = render(
      <TypographyBlock classes="" computedStyles={null} onClassesChange={vi.fn()} />,
    );
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['F'], 'My-Brand.woff2')] },
    });
    // weight select appears once the upload resolves
    const weightSelect = await screen.findByDisplayValue('400');
    fireEvent.change(weightSelect, { target: { value: '700' } });

    await waitFor(() => expect(h.updateLocal).toHaveBeenCalledWith(
      'browser_lf_testsite',
      { family: 'My Brand', format: 'woff2', srcUrl: '/fonts/My-Brand.woff2' },
      700, false,
    ));
    await waitFor(() => expect(h.dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_PROJECT_FONT',
      family: 'My Brand',
      entry: { source: 'custom', css: 'REBAKED', assetIds: [] },
    }));
  });
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

describe('TypographyBlock finite failures and ownership', () => {
  it('preserves the applied font and hides raw download errors', async () => {
    h.pickLocal.mockRejectedValue(new Error('SECRET /private?token=abc'));
    const onClassesChange = vi.fn();
    const { container } = render(<TypographyBlock classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    expect(await screen.findByRole('status')).toHaveTextContent('Font could not be applied');
    expect(container).not.toHaveTextContent('SECRET');
    expect(onClassesChange).not.toHaveBeenCalled();
    expect(h.dispatchSpy).not.toHaveBeenCalled();
    expect(h.pickLocal).toHaveBeenCalledTimes(1);
  });
  it('does not render arbitrary returned warnings', async () => {
    h.pickLocal.mockResolvedValue({ css: 'LOCAL_CSS', warning: 'SECRET server detail' });
    const onClassesChange = vi.fn();
    const { container } = render(<TypographyBlock classes="" onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    await waitFor(() => expect(onClassesChange).toHaveBeenCalled());
    expect(container).not.toHaveTextContent('SECRET');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it.each(['selection', 'project', 'unmount', 'classes'] as const)('does not apply late font classes after %s changes', async change => {
    const pending = deferred<{ css: string; warning: null }>(); h.pickLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    if (change === 'selection') view.rerender(<TypographyBlock elementKey="b" classes="font-serif" onClassesChange={onClassesChange} />);
    if (change === 'project') { h.projectId = 'browser_lf_other'; view.rerender(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={onClassesChange} />); }
    if (change === 'classes') view.rerender(<TypographyBlock elementKey="a" classes="font-serif text-lg" onClassesChange={onClassesChange} />);
    if (change === 'unmount') view.unmount();
    await act(async () => pending.resolve({ css: 'LOCAL_CSS', warning: null }));
    expect(onClassesChange).not.toHaveBeenCalled();
    if (change === 'selection' || change === 'classes') expect(h.dispatchSpy).toHaveBeenCalledWith({ type: 'SET_PROJECT_FONT', family: 'Open Sans', entry: { source: 'google', css: 'LOCAL_CSS', assetIds: [] } });
    if (change === 'project') expect(h.dispatchSpy).not.toHaveBeenCalled();
  });
  it('preserves the custom weight on a failed local update', async () => {
    h.updateLocal.mockRejectedValue(new Error('SECRET update failed'));
    const { container } = render(<TypographyBlock classes="" onClassesChange={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'My-Brand.woff2')] } });
    fireEvent.change(await screen.findByDisplayValue('400'), { target: { value: '700' } });
    expect(await screen.findByRole('status')).toHaveTextContent('Font settings could not be updated');
    expect(screen.getByDisplayValue('400')).toBeVisible();
    expect(container).not.toHaveTextContent('SECRET');
  });
  it('distinguishes a saved manifest from a failed preview transfer', async () => {
    h.projectId = 'project_dexie'; h.pickGoogle.mockResolvedValue({ css: 'DEXIE_CSS', assetIds: ['asset-a'] });
    h.dbGet.mockRejectedValue(new Error('SECRET relay failed'));
    const onClassesChange = vi.fn();
    const { container } = render(<TypographyBlock classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    expect(await screen.findByRole('status')).toHaveTextContent('Font saved; preview could not update');
    expect(h.dispatchSpy).toHaveBeenCalledWith({ type: 'SET_PROJECT_FONT', family: 'Open Sans', entry: { source: 'google', css: 'DEXIE_CSS', assetIds: ['asset-a'] } });
    expect(onClassesChange).not.toHaveBeenCalled();
    expect(container).not.toHaveTextContent('SECRET');
  });
  it('keeps upload validation beside its control without an operation notice', () => {
    const { container } = render(<TypographyBlock classes="" onClassesChange={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'bad.exe')] } });
    expect(screen.getByText('Only WOFF2, WOFF, TTF, and OTF files are allowed')).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull(); expect(h.uploadLocal).not.toHaveBeenCalled();
  });
});

describe('TypographyBlock recovery ownership', () => {
  it('clears failed font feedback when a system font is applied', async () => {
    h.pickLocal.mockRejectedValue(new Error('failed'));
    const onClassesChange = vi.fn();
    render(<TypographyBlock classes="" onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    await screen.findByRole('status');
    fireEvent.click(screen.getByTestId('system-font'));
    expect(onClassesChange).toHaveBeenCalledWith('font-serif', expect.any(Function));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('does not replace a newer synchronous font choice with a late download', async () => {
    const pending = deferred<{ css: string; warning: null }>(); h.pickLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    render(<TypographyBlock classes="" onClassesChange={onClassesChange} />);
    fireEvent.click(screen.getByTestId('pick-font'));
    fireEvent.click(screen.getByTestId('system-font'));
    await act(async () => pending.resolve({ css: 'LOCAL_CSS', warning: null }));
    expect(onClassesChange.mock.calls).toEqual([['font-serif', expect.any(Function)]]);
  });
  it('does not paint a late upload failure on a new selection', async () => {
    const pending = deferred<never>(); h.uploadLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock elementKey="a" classes="" onClassesChange={onClassesChange} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'Brand.woff2')] } });
    view.rerender(<TypographyBlock elementKey="b" classes="" onClassesChange={onClassesChange} />);
    await act(async () => pending.reject(new Error('SECRET stale failure')));
    expect(screen.queryByRole('status')).toBeNull();
    expect(view.container).not.toHaveTextContent('SECRET');
    expect(onClassesChange).not.toHaveBeenCalled();
  });
  it('retains an acknowledged upload manifest without styling a new selection', async () => {
    const pending = deferred<{ family: string; format: string; srcUrl: string; css: string; warning: null }>(); h.uploadLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock elementKey="a" classes="" onClassesChange={onClassesChange} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'Brand.woff2')] } });
    view.rerender(<TypographyBlock elementKey="b" classes="" onClassesChange={onClassesChange} />);
    await act(async () => pending.resolve({ family: 'Brand', format: 'woff2', srcUrl: '/fonts/Brand.woff2', css: 'BRAND_CSS', warning: null }));
    expect(h.dispatchSpy).toHaveBeenCalledWith({ type: 'SET_PROJECT_FONT', family: 'Brand', entry: { source: 'custom', css: 'BRAND_CSS', assetIds: [] } });
    expect(onClassesChange).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('400')).toBeNull();
  });
  it('keeps an uploaded Dexie font in the manifest after preview transfer fails', async () => {
    h.projectId = 'project_dexie'; h.uploadAsset.mockResolvedValue({ assetId: 'font-a', url: 'blob:font' }); h.transferAsset.mockRejectedValue(new Error('SECRET transfer'));
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'Brand.woff2')] } });
    expect(await screen.findByRole('status')).toHaveTextContent('Font saved; preview could not update');
    expect(h.dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PROJECT_FONT', family: 'Brand', entry: expect.objectContaining({ assetIds: ['font-a'] }) }));
    expect(onClassesChange).not.toHaveBeenCalled();
    expect(view.container).not.toHaveTextContent('SECRET');
  });
});

it('does not apply a late font through an obsolete breakpoint callback', async () => {
  const pending = deferred<{ css: string; warning: null }>(); h.pickLocal.mockReturnValue(pending.promise);
  const oldCallback = vi.fn(); const newCallback = vi.fn();
  const view = render(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={oldCallback} />);
  fireEvent.click(screen.getByTestId('pick-font'));
  view.rerender(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={newCallback} />);
  await act(async () => pending.resolve({ css: 'LOCAL_CSS', warning: null }));
  expect(oldCallback).not.toHaveBeenCalled(); expect(newCallback).not.toHaveBeenCalled();
  expect(h.dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PROJECT_FONT', family: 'Open Sans' }));
});

// Font settings belong to the uploaded font; ordinary typography edits must
// not discard the acknowledged CSS settings or their local failure feedback.
describe('TypographyBlock acknowledged custom-font settings', () => {
  it.each(['classes', 'callback'] as const)('updates the same font controls after an unrelated %s revision', async change => {
    const pending = deferred<{ css: string }>(); h.updateLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'My-Brand.woff2')] } });
    fireEvent.change(await screen.findByDisplayValue('400'), { target: { value: '700' } });
    view.rerender(<TypographyBlock elementKey="a" classes={change === 'classes' ? 'font-serif text-lg' : 'font-serif'} onClassesChange={change === 'callback' ? vi.fn() : onClassesChange} />);
    await act(async () => pending.resolve({ css: 'WEIGHT_700' }));
    expect(h.dispatchSpy).toHaveBeenCalledWith({ type: 'SET_PROJECT_FONT', family: 'My Brand', entry: { source: 'custom', css: 'WEIGHT_700', assetIds: [] } });
    expect(screen.getByDisplayValue('700')).toBeEnabled();
    h.updateLocal.mockResolvedValue({ css: 'VARIABLE_700' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Variable' }));
    await waitFor(() => expect(h.updateLocal).toHaveBeenLastCalledWith('browser_lf_testsite', { family: 'My Brand', format: 'woff2', srcUrl: '/fonts/My-Brand.woff2' }, 700, true));
  });
  it('keeps a settings failure visible for the same font after a class edit', async () => {
    const pending = deferred<{ css: string }>(); h.updateLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'My-Brand.woff2')] } });
    fireEvent.change(await screen.findByDisplayValue('400'), { target: { value: '700' } });
    view.rerender(<TypographyBlock elementKey="a" classes="font-serif text-lg" onClassesChange={onClassesChange} />);
    await act(async () => pending.reject(new Error('SECRET settings')));
    expect(screen.getByRole('status')).toHaveTextContent('Font settings could not be updated');
    expect(screen.getByDisplayValue('400')).toBeEnabled();
    expect(view.container).not.toHaveTextContent('SECRET');
  });
  it('does not replace the controls of a new uploaded font with old settings', async () => {
    const pending = deferred<{ css: string }>(); h.updateLocal.mockReturnValue(pending.promise);
    const onClassesChange = vi.fn();
    const view = render(<TypographyBlock elementKey="a" classes="font-serif" onClassesChange={onClassesChange} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'My-Brand.woff2')] } });
    fireEvent.change(await screen.findByDisplayValue('400'), { target: { value: '700' } });
    view.rerender(<TypographyBlock elementKey="b" classes="font-serif" onClassesChange={onClassesChange} />);
    h.uploadLocal.mockResolvedValue({ family: 'Other', format: 'woff2', srcUrl: '/fonts/Other.woff2', css: 'OTHER_CSS', warning: null });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['F'], 'Other.woff2')] } });
    await screen.findByDisplayValue('400');
    await act(async () => pending.resolve({ css: 'WEIGHT_700' }));
    expect(screen.getByDisplayValue('400')).toBeEnabled();
    expect(screen.queryByDisplayValue('700')).toBeNull();
    expect(h.dispatchSpy).toHaveBeenCalledWith({ type: 'SET_PROJECT_FONT', family: 'My Brand', entry: { source: 'custom', css: 'WEIGHT_700', assetIds: [] } });
  });
});

// font-[Inter] is a family for Tailwind; a font pick left it and wrote a second
// family beside it (found live 2026-11-12).
it('a font pick replaces an unquoted arbitrary family', () => {
  const onClassesChange = vi.fn();
  render(<TypographyBlock classes="font-[Inter] font-[650]" computedStyles={null} onClassesChange={onClassesChange} />);
  fireEvent.click(screen.getByTestId('system-font'));
  expect(onClassesChange).toHaveBeenCalledWith('font-[650] font-serif', expect.any(Function));
});
