import { memo, useCallback, useRef, useState } from 'react';
import { useExclusiveMenu } from './hoverMenu';
import { GridChip } from './GridChip';
import { Button, Menu, MenuItem } from '@/components/ui';
import { ChevronDownIcon } from '@/assets/icons';
import { useYjsValue, useDispatch, useProjectId } from '@/store/hooks';
import { DEVICE_OF, SCREEN_PRESETS, setScreenHeight, useScreenHeight } from './viewportHeightPreferences';
import { selectCurrentBreakpoint, selectCurrentThemeMode } from '@/store/selectors';
import { selectVariableCollections } from '@/store/variableSelectors';
import type { Breakpoint } from '@/store/types';
import { BREAKPOINTS } from '@/store/types';

const BREAKPOINT_LABELS: Record<Breakpoint, string> = {
  base: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  '2xl': '2xl',
};

const breakpoints: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl', '2xl'];

const HOVER_CLOSE_DELAY_MS = 150;

/** Button that opens its Menu on hover (and click); closes on mouse-out of both. */
function HoverMenuButton({
  label,
  detail,
  menuWidth,
  children,
}: {
  label: string;
  detail?: string;
  menuWidth?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  useExclusiveMenu(open, setOpen); // only one top-bar menu at a time (claiming closes the other one)

  return (
    <div
      ref={triggerRef}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="px-3 gap-1.5"
        label={label}
        iconRight={
          <span className="flex items-center gap-1">
            {detail && <span className="text-3xs text-text-muted">{detail}</span>}
            <ChevronDownIcon className="w-4 h-4 text-text-muted" />
          </span>
        }
      />
      <Menu isOpen={open} onClose={() => setOpen(false)} triggerRef={triggerRef} placement="bottom" offset={4} width={menuWidth}>
        <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onClick={() => setOpen(false)}>
          {children}
        </div>
      </Menu>
    </div>
  );
}

export const BreakpointBar = memo(function BreakpointBar({ children }: { children?: React.ReactNode }) {
  const dispatch = useDispatch();
  const currentBreakpoint = useYjsValue(selectCurrentBreakpoint);
  const currentThemeMode = useYjsValue(selectCurrentThemeMode);
  const collections = useYjsValue(selectVariableCollections);
  const projectId = useProjectId();
  const device = DEVICE_OF[currentBreakpoint];
  const screenH = useScreenHeight(projectId, device);

  // Unique variable-mode names across collections; keyed lowercased to match
  // the [data-mode] selector emitted by cssGenerator.ts. Default = :root.
  const modes: { key: string | null; name: string }[] = [];
  const seen = new Set<string>();
  for (const col of collections) {
    for (const mode of col.modes) {
      const lower = mode.name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      modes.push({ key: mode.isDefault ? null : lower, name: mode.name });
    }
  }
  const activeMode = modes.find((m) => m.key === currentThemeMode) ?? modes[0];

  return (
    <div className="flex-1 flex items-center justify-center gap-1">
      <HoverMenuButton
        label={BREAKPOINT_LABELS[currentBreakpoint]}
        detail={String(BREAKPOINTS[currentBreakpoint])}
        menuWidth={176}
      >
        {breakpoints.map((bp, i) => (
          <MenuItem
            key={bp}
            label={BREAKPOINT_LABELS[bp]}
            caption={String(BREAKPOINTS[bp])}
            shortcut={String(i + 1)}
            selected={bp === currentBreakpoint}
            showCheck={false}
            onSelect={() => dispatch({ type: 'SET_BREAKPOINT', breakpoint: bp })}
          />
        ))}
      </HoverMenuButton>
      {/* Screen height: one per device class (all desktop widths share it). */}
      <HoverMenuButton label={`H ${screenH}`} detail={device} menuWidth={208}>
        {SCREEN_PRESETS[device].map((p) => (
          <MenuItem
            key={p.height}
            label={p.label}
            caption={String(p.height)}
            selected={p.height === screenH}
            showCheck={false}
            onSelect={() => setScreenHeight(projectId, device, p.height)}
          />
        ))}
      </HoverMenuButton>
      {modes.length > 0 && activeMode && (
        <HoverMenuButton label={activeMode.name}>
          {modes.map((m) => (
            <MenuItem
              key={m.key ?? '__default__'}
              label={m.name}
              selected={m === activeMode}
              showCheck={false}
              onSelect={() => dispatch({ type: 'SET_THEME_MODE', mode: m.key })}
            />
          ))}
        </HoverMenuButton>
      )}
      <GridChip projectId={projectId} />
      {children}
    </div>
  );
});
