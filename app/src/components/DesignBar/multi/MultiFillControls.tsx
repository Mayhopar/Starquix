/** Fill while ≥2 are selected: one background colour or one gradient for all (design §2 "Fill in multi",
 *  C8). FillBlock is not reused: its writers act on ONE element's media and structure (no Media tab here). */
import { useEffect, useState } from 'react';
import { getPropertyGroup } from '@/core/classes/index';
import { SegmentedControl, Field, Row } from '@/components/ui';
import { ColorPicker } from '../ColorPicker';
import { GRADIENT_DIRECTIONS } from '../classPatterns';
import { useMixedValue, useMultiMembers, type Owns } from './mixed';

const BG_COLOR = /^bg-(?:white|black|transparent|current|inherit|[a-z]+-\d{2,3}|\[#[\da-f]+\]|\[(?:color:)?var\([^\]]+\)\])(?:\/\d+)?$/i;
const IMAGE_GROUPS = ['standalone:bgImage', 'standalone:bgSize', 'standalone:bgPosition', 'standalone:bgRepeat'];
const GRADIENT_DIR = /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/;
/** What a member without a gradient gets when the Gradient tab is picked. */
const DEFAULT_GRADIENT = ['bg-gradient-to-r', 'from-white', 'to-black'];

/** The solid colour a member shows ('' = none). */
export const readFillColor = (classes: string) => classes.split(/\s+/).find(t => BG_COLOR.test(t)) ?? '';

/** A colour replaces the fill kind: colour, gradient and background-image tokens — the same set the
 *  Fill tab strips on a colour pick (services/imageFillModel.ts changeBackgroundFill). */
export const ownsFillKind: Owns = t => BG_COLOR.test(t) || /^bg-gradient-/.test(t) || /^(from|via|to)-/.test(t)
  || IMAGE_GROUPS.includes(getPropertyGroup(t));

type Stop = 'from' | 'via' | 'to';
/** A stop's COLOUR token (`from-10%` is a position, not a colour). */
const stopColor = (stop: Stop): Owns => t => t.startsWith(`${stop}-`) && BG_COLOR.test(`bg-${t.slice(stop.length + 1)}`);
const STOP_OWNS: Record<Stop, Owns> = { from: stopColor('from'), via: stopColor('via'), to: stopColor('to') };
const ownsDirection: Owns = t => /^bg-gradient-/.test(t);

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);
const readDirection = (classes: string) => tokens(classes).find(t => GRADIENT_DIR.test(t))?.slice('bg-gradient-'.length) ?? '';
const STOP_READERS: Record<Stop, (classes: string) => string> = {
  from: c => tokens(c).find(STOP_OWNS.from) ?? '',
  via: c => tokens(c).find(STOP_OWNS.via) ?? '',
  to: c => tokens(c).find(STOP_OWNS.to) ?? '',
};
const STOPS: Array<{ stop: Stop; title: string; placeholder: string }> = [
  { stop: 'from', title: 'From', placeholder: 'Start color' },
  { stop: 'via', title: 'Via (optional)', placeholder: 'Middle color' },
  { stop: 'to', title: 'To', placeholder: 'End color' },
];

/** Gradient tab: members with a gradient keep it; the rest get the default in place of their fill kind. */
export const toGradient = (effective: string[]) => effective.some(t => GRADIENT_DIR.test(t))
  ? effective : [...effective.filter(t => !ownsFillKind(t)), ...DEFAULT_GRADIENT];

export function MultiFillControls({ classes, onClassesChange, applyToEach }: {
  classes: string;
  onClassesChange: (next: string, owns?: Owns) => void;
  /** One batch over every member (one save, one ⌘Z) — the Gradient tab's per-member switch. */
  applyToEach: (transform: (effective: string[]) => string[]) => void;
}) {
  const members = useMultiMembers();
  const detected = members?.length && members.every(c => readDirection(c)) ? 'gradient' : 'solid';
  const [tab, setTab] = useState(detected);
  // Follow the members when their fill kind changes underneath (⌘Z, another edit) — FillBlock's tab sync.
  useEffect(() => setTab(detected), [detected]);
  const mixed = {
    color: useMixedValue(readFillColor),
    direction: useMixedValue(readDirection),
    from: useMixedValue(STOP_READERS.from),
    via: useMixedValue(STOP_READERS.via),
    to: useMixedValue(STOP_READERS.to),
  };
  /** Replace what `owns` claims in the merged list with `add` (only owned tokens reach the members). */
  const write = (owns: Owns, add: string[]) => onClassesChange([...tokens(classes).filter(t => !owns(t)), ...add].join(' '), owns);
  const pickTab = (next: string) => {
    if (next === 'gradient' && tab !== 'gradient') applyToEach(toGradient); // Solid applies nothing until a pick
    setTab(next);
  };

  return (
    <div className="space-y-1 pr-8 pb-2">
      <SegmentedControl
        options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]}
        value={tab}
        onChange={pickTab}
        showChevron={false}
      />
      {tab === 'solid' ? (
        <ColorPicker prefix="bg" value={readFillColor(classes)} mixed={mixed.color} onChange={value => onClassesChange(value, ownsFillKind)} />
      ) : (
        <>
          <div>
            <Row title="Direction" size="sm" />
            <Field
              as="select"
              aria-label="Gradient direction"
              value={readDirection(classes)}
              mixed={mixed.direction}
              onChange={dir => write(ownsDirection, dir ? [`bg-gradient-${dir}`] : [])}
              options={GRADIENT_DIRECTIONS}
              placeholder="Select direction"
            />
          </div>
          {STOPS.map(({ stop, title, placeholder }) => (
            <div key={stop}>
              <Row title={title} size="sm" />
              <ColorPicker
                prefix="bg"
                placeholder={placeholder}
                value={STOP_READERS[stop](classes).replace(new RegExp(`^${stop}-`), 'bg-')}
                mixed={mixed[stop]}
                onChange={colorClass => write(STOP_OWNS[stop], colorClass ? [colorClass.replace(/^bg-/, `${stop}-`)] : [])}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
