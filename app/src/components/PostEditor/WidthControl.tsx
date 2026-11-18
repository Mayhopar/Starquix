import { WidthMeasureIcon, WidthWideIcon, WidthFullIcon } from '@/assets/icons';
import { Button } from '@/components/ui';

export type SpanMode = number | 'full' | null;

/**
 * Width modes as a button group (no panel — it rides the shared component
 * toolbar): Text width (span null), Wide (12), Full width — the page's three
 * alignment lines, named the same as the layout toolbar's (StackToolbar). One
 * bar drawn at three lengths — the same object, three widths — so the group
 * reads without words; tooltips carry the words.
 */
export const DEFAULT_SPAN = 8;

const MODES: Array<{ span: SpanMode; label: string; barPct: number }> = [
  { span: null, label: 'Text width', barPct: 55 },
  { span: 12, label: 'Wide', barPct: 80 },
  { span: 'full', label: 'Full width', barPct: 100 },
];

function isActive(mode: SpanMode, span: SpanMode): boolean {
  if (mode === null) return span === null || span === DEFAULT_SPAN;
  return span === mode;
}

function WidthIcon({ pct }: { pct: number }) {
  const Icon = pct === 100 ? WidthFullIcon : pct === 80 ? WidthWideIcon : WidthMeasureIcon;
  return <Icon className="w-4 h-4" />;
}

export function WidthModes({ span, onChange }: {
  span: SpanMode;
  onChange: (span: SpanMode) => void;
}) {
  return (
    <>
      {MODES.map(mode => (
        <Button
          key={String(mode.span)}
          size="sm"
          variant="ghost"
          iconOnly
          active={isActive(mode.span, span)}
          aria-label={mode.label}
          title={mode.label}
          onClick={() => onChange(mode.span)}
        >
          <WidthIcon pct={mode.barPct} />
        </Button>
      ))}
    </>
  );
}
