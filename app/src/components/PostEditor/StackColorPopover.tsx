import { useEffect, useRef, useState } from 'react';
import { Button, Popover, Row, Swatch } from '@/components/ui';
import { ColorPicker } from '@/components/DesignBar/ColorPicker';
import { applyAutoText, colorClassOf, resolveColorClass, withColorClass } from '@/core/stack/stackColor';

/**
 * Color · Background + Text (Auto default) for a layout (design D4). The
 * classes are written literally; Auto recomputes the text class from the
 * resolved background (P9). Variables come from the existing picker model.
 */
export function StackColorPopover({ cls, textAuto, lookupVar, onChange, openSignal = 0 }: {
  /** bumping it opens the popover (the formatting toolbar's Color lands here) */
  openSignal?: number;
  cls: string;
  textAuto: boolean;
  lookupVar: (name: string) => string | null;
  onChange: (cls: string, textAuto: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);
  const bg = colorClassOf(cls, 'bg');
  const bgHex = bg ? resolveColorClass(bg, lookupVar) : null;
  const setBg = (next: string) => {
    const withBg = withColorClass(cls, 'bg', next);
    onChange(textAuto ? applyAutoText(withBg, lookupVar) : withBg, textAuto);
  };
  return <>
    <Button ref={triggerRef} size="sm" variant="ghost" iconOnly aria-label="Color" title="Color" active={open}
      icon={<Swatch color={bgHex ?? 'transparent'} size="sm" />} onClick={() => setOpen(o => !o)} />
    <Popover isOpen={open} onClose={() => setOpen(false)} triggerRef={triggerRef} placement="bottom-start" offset={4} width={260}>
      <div className="p-3 space-y-1" aria-label="Layout color" role="group">
        <Row size="sm" hover={false} title="Background"
          right={[{ type: 'custom', unboxed: true, node: <ColorPicker prefix="bg" value={bg} onChange={setBg} placeholder="None" /> }]} />
        {/* The picker always shows the ACTUAL text color (Auto's pick included);
            choosing one turns Auto off — two "Auto" controls read as "can't
            change" (owner, 2026-09-29). */}
        <Row size="sm" hover={false} title="Text"
          right={[{ type: 'custom', unboxed: true, node: <ColorPicker prefix="text" value={colorClassOf(cls, 'text')} placeholder="Default"
            onChange={next => onChange(withColorClass(cls, 'text', next), false)} /> }]} />
        <Row size="sm" hover={false} title="Auto contrast" caption="Black or white, for readability"
          right={[{ type: 'toggle', value: textAuto, 'aria-label': 'Auto contrast',
            onChange: (on) => onChange(on ? applyAutoText(cls, lookupVar) : cls, on) }]} />
      </div>
    </Popover>
  </>;
}
