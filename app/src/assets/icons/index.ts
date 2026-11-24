/**
 * Centralized Icon Components
 *
 * All icons for the application are imported from SVG files.
 * SVG files are located in this directory for easy browsing.
 *
 * Usage:
 *   import { IconName } from '@/assets/icons';
 *
 * Icons use currentColor for fills/strokes, so color is controlled via className.
 */

import { createElement, type FC, type SVGProps } from 'react';

// Icon component type for consumers
export type IconProps = SVGProps<SVGSVGElement> & { className?: string };
export type IconComponent = FC<IconProps>;

// Icons are plain .svg files rendered as an inline <svg>: root attributes become
// props (kebab → camel), the body is injected as-is. Caller props win.
const svgs = import.meta.glob<string>('./*.svg', { query: '?raw', import: 'default', eager: true });
const toProp = (k: string) => (/^(data|aria)-/.test(k) ? k : k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()));
function icon(name: string): IconComponent {
  const src = svgs[`./${name}.svg`];
  const m = src?.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`icons: ./${name}.svg missing or not an <svg>`);
  const root = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [toProp(k), v]));
  const html = { __html: m[2] };
  const Icon: IconComponent = ({ children: _children, ...props }) => createElement('svg', { ...root, ...props, dangerouslySetInnerHTML: html });
  Icon.displayName = name;
  return Icon;
}
const AlignBottomIcon = icon('align-bottom');
const AlignHorMiddleIcon = icon('align-hor-middle');
const AlignItemsCenterIcon = icon('align-items-center');
const AlignItemsEndIcon = icon('align-items-end');
const AlignItemsStartIcon = icon('align-items-start');
const AlignItemsStretchIcon = icon('align-items-stretch');
const AlignLeftIcon = icon('align-left');
const AlignMiddleIcon = icon('align-middle');
const AlignRightIcon = icon('align-right');
const AlignTopIcon = icon('align-top');
const AngleIcon = icon('angle');
const ArrowCurlIcon = icon('arrow-curl');
const ArrowDownIcon = icon('arrow-down');
const ArrowLeftIcon = icon('arrow-left');
const ArrowRightIcon = icon('arrow-right');
const ArrowUpIcon = icon('arrow-up');
const BetweenHorisontalIcon = icon('between-horizontal');
const BetweenVerticalIcon = icon('between-vertical');
const BlurIcon = icon('blur');
const BorderBIcon = icon('border-b');
const BorderLIcon = icon('border-l');
const BorderRIcon = icon('border-r');
const BorderTIcon = icon('border-t');
const CardIcon = icon('card');
const CheckIcon = icon('check');
const CodeBracesIcon = icon('code-braces');
const ChevronDownBigIcon = icon('chevron-down-big');
const ChevronDownIcon = icon('chevron-down');
const ChevronRightIcon = icon('chevron-right');
const ChevronTreeIcon = icon('chevron-tree');
const ChevronUpBigIcon = icon('chevron-up-big');
const ChevronUpIcon = icon('chevron-up');
const CircleIcon = icon('circle');
const CloseIcon = icon('close');
const CursorIcon = icon('cursor');
const ColCIcon = icon('col-c');
const ColEndIcon = icon('col-end');
const ColFIcon = icon('col-f');
const ColLIcon = icon('col-l');
const ColRIcon = icon('col-r');
const ColStartIcon = icon('col-start');
const ColorIcon = icon('color');
const ColumnsIcon = icon('columns');
const ComponentIcon = icon('component');
const ContainerIcon = icon('container');
const FolderIcon = icon('folder');
const DeleteIcon = icon('delete');
const DotIcon = icon('dot');
const DownloadIcon = icon('download');
const FillIcon = icon('fill');
const FixedWidthIcon = icon('fixed-width');
const FrameIcon = icon('frame');
const GearIcon = icon('gear');
const GapIcon = icon('gap');
const GapXIcon = icon('gap-x');
const GapXyIcon = icon('gap-xy');
const GapYIcon = icon('gap-y');
const HiddenIcon = icon('hidden');
const LockIcon = icon('lock');
const HomeIcon = icon('home');
const HomeFilledIcon = icon('home-filled');
const HugIcon = icon('hug');
const ImageIcon = icon('image');
const IndividualIcon = icon('individual');
const InsetBottomIcon = icon('inset-bottom');
const InsetLeftIcon = icon('inset-left');
const InsetRightIcon = icon('inset-right');
const InsetTopIcon = icon('inset-top');
const InstanceIcon = icon('instance');
const InvisibleIcon = icon('invisible');
const LayerImageIcon = icon('layer-image');
const LayerLinkIcon = icon('layer-link');
const LayerTextIcon = icon('layer-text');
const LetterSpacingIcon = icon('letter-spacing');
const LineHeightIcon = icon('line-height');
const LinkIcon = icon('link');
const MaxWidthIcon = icon('max-width');
const MbIcon = icon('mb');
const MinWidthIcon = icon('min-width');
const MinusIcon = icon('minus');
const MlIcon = icon('ml');
const MoonIcon = icon('moon');
const MrIcon = icon('mr');
const MtIcon = icon('mt');
const MxIcon = icon('mx');
const MyIcon = icon('my');
const NewspaperIcon = icon('newspaper');
const NewtabIcon = icon('newtab');
const OpacityIcon = icon('opacity');
const PIcon = icon('p');
const PageIcon = icon('page');
const PbIcon = icon('pb');
const PencilIcon = icon('pencil');
const PlIcon = icon('pl');
const PlusIcon = icon('plus');
const PlusLargeIcon = icon('plus-large');
const PrIcon = icon('pr');
const PtIcon = icon('pt');
const PxIcon = icon('px');
const PyIcon = icon('py');
const RadiusBlIcon = icon('radius-bl');
const RadiusBrIcon = icon('radius-br');
const RadiusTlIcon = icon('radius-tl');
const ScaleIcon = icon('scale');
const RadiusTrIcon = icon('radius-tr');
const RatioIcon = icon('ratio');
const RectangleIcon = icon('rectangle');
const RedoIcon = icon('redo');
const RobotIcon = icon('robot');
const RocketIcon = icon('rocket');
const RowBIcon = icon('row-b');
const RowCIcon = icon('row-c');
const RowEndIcon = icon('row-end');
const RowFIcon = icon('row-f');
const RowStartIcon = icon('row-start');
const RowTIcon = icon('row-t');
const RowsIcon = icon('rows');
const SearchIcon = icon('search');
const SendIcon = icon('send');
const StopIcon = icon('stop');
const TerminalIcon = icon('terminal');
const ServerIcon = icon('server');
const ShadowXIcon = icon('shadow-x');
const ShadowYIcon = icon('shadow-y');
const ShapesIcon = icon('shapes');
const ShareIcon = icon('share');
const SlotIcon = icon('slot');
const SparkleIcon = icon('sparkle');
const SparklesIcon = icon('sparkles');
const StrokeWidthIcon = icon('stroke-width');
const SunIcon = icon('sun');
const TextIcon = icon('text');
const TrashIcon = icon('trash');
const TriangleIcon = icon('triangle');
const TypeIcon = icon('type');
const UndoIcon = icon('undo');
const VideoIcon = icon('video');
const VisibleIcon = icon('visible');
const YxGapIcon = icon('yx-gap');
const ZindexIcon = icon('zindex');

// Export all icons
export {
  AlignBottomIcon,
  AlignHorMiddleIcon,
  AlignItemsCenterIcon,
  AlignItemsEndIcon,
  AlignItemsStartIcon,
  AlignItemsStretchIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  AngleIcon,
  ArrowCurlIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BetweenHorisontalIcon,
  BetweenVerticalIcon,
  BlurIcon,
  BorderBIcon,
  BorderLIcon,
  BorderRIcon,
  BorderTIcon,
  CardIcon,
  CheckIcon,
  CodeBracesIcon,
  ChevronDownBigIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronTreeIcon,
  ChevronUpBigIcon,
  ChevronUpIcon,
  CircleIcon,
  CloseIcon,
  CursorIcon,
  ColCIcon,
  ColEndIcon,
  ColFIcon,
  ColLIcon,
  ColRIcon,
  ColStartIcon,
  ColorIcon,
  ColumnsIcon,
  ComponentIcon,
  ContainerIcon,
  FolderIcon,
  DeleteIcon,
  DotIcon,
  DownloadIcon,
  FillIcon,
  FixedWidthIcon,
  FrameIcon,
  GearIcon,
  GapIcon,
  GapXIcon,
  GapXyIcon,
  GapYIcon,
  HiddenIcon,
  LockIcon,
  HomeIcon,
  HomeFilledIcon,
  HugIcon,
  ImageIcon,
  IndividualIcon,
  InsetBottomIcon,
  InsetLeftIcon,
  InsetRightIcon,
  InsetTopIcon,
  InstanceIcon,
  InvisibleIcon,
  LayerImageIcon,
  LayerLinkIcon,
  LayerTextIcon,
  LetterSpacingIcon,
  LineHeightIcon,
  LinkIcon,
  MaxWidthIcon,
  MbIcon,
  MinWidthIcon,
  MinusIcon,
  MlIcon,
  MoonIcon,
  MrIcon,
  MtIcon,
  MxIcon,
  MyIcon,
  NewspaperIcon,
  NewtabIcon,
  OpacityIcon,
  PIcon,
  PageIcon,
  PbIcon,
  PencilIcon,
  PlIcon,
  PlusIcon,
  PlusLargeIcon,
  PrIcon,
  PtIcon,
  PxIcon,
  PyIcon,
  RadiusBlIcon,
  RadiusBrIcon,
  RadiusTlIcon,
  ScaleIcon,
  RadiusTrIcon,
  RatioIcon,
  RectangleIcon,
  RedoIcon,
  RobotIcon,
  RocketIcon,
  RowBIcon,
  RowCIcon,
  RowEndIcon,
  RowFIcon,
  RowStartIcon,
  RowTIcon,
  RowsIcon,
  SearchIcon,
  SendIcon,
  StopIcon,
  TerminalIcon,
  ServerIcon,
  ShadowXIcon,
  ShadowYIcon,
  ShapesIcon,
  ShareIcon,
  SlotIcon,
  SparkleIcon,
  SparklesIcon,
  StrokeWidthIcon,
  SunIcon,
  TextIcon,
  TrashIcon,
  TriangleIcon,
  TypeIcon,
  UndoIcon,
  VideoIcon,
  VisibleIcon,
  YxGapIcon,
  ZindexIcon,
};

// Aliases for backwards compatibility
export {
  BorderBIcon as BorderBottomIcon,
  BorderLIcon as BorderLeftIcon,
  BorderRIcon as BorderRightIcon,
  BorderTIcon as BorderTopIcon,
  MbIcon as MarginBottomIcon,
  MlIcon as MarginLeftIcon,
  MrIcon as MarginRightIcon,
  MtIcon as MarginTopIcon,
  MxIcon as MarginXIcon,
  MyIcon as MarginYIcon,
  PbIcon as PaddingBottomIcon,
  PlIcon as PaddingLeftIcon,
  PrIcon as PaddingRightIcon,
  PtIcon as PaddingTopIcon,
  PxIcon as PaddingXIcon,
  PyIcon as PaddingYIcon,
  PIcon as PaddingIcon,

  ColCIcon as ColCenterIcon,
  ColFIcon as ColFillIcon,
  ColLIcon as ColLeftIcon,
  ColRIcon as ColRightIcon,
  ArrowCurlIcon as WrapIcon,
};

// Shared editor chrome.
export const ArrowUpRightIcon = icon('arrow-up-right');
export const DiscordIcon = icon('discord');
export const CornerRadiusIcon = icon('corner-radius');
export const EditPageIcon = icon('edit-page');
export const FileTextIcon = icon('file-text');
export const FolderPlusIcon = icon('folder-plus');
export const GripIcon = icon('grip');
export const LineIcon = icon('line');
export const MoreIcon = icon('more');
export const PaletteIcon = icon('palette');
export const PauseIcon = icon('pause');
export const PenPathIcon = icon('pen-path');
export const PlayIcon = icon('play');
export const PolygonIcon = icon('polygon');
export const RefreshIcon = icon('refresh');
export const HistoryIcon = icon('history');
export const ResizeIcon = icon('resize');
export const ShuffleIcon = icon('shuffle');
export const SvgLayerIcon = icon('svg-layer');
export const SwatchesIcon = icon('swatches');
export const TextAlignCenterIcon = icon('text-align-center');
export const UploadIcon = icon('upload');
export const AlignCenterIcon = icon('text-align-center');
export const WidthMeasureIcon = icon('width-measure');
export const WidthWideIcon = icon('width-wide');
export const WidthFullIcon = icon('width-full');
// Editorial layouts (task-242)
export const LayoutTextImageIcon = icon('layout-text-image');
export const LayoutTwoColumnsIcon = icon('layout-two-columns');
export const LayoutColoredSectionIcon = icon('layout-colored-section');
export const LayoutSwapIcon = icon('layout-swap');
export const LayoutSideBySideIcon = icon('layout-side-by-side');
export const LayoutStackedIcon = icon('layout-stacked');
export const Media1Icon = icon('media-1');
export const Media2Icon = icon('media-2');
export const Media3Icon = icon('media-3');
export const ContainerFlexRowIcon = icon('container-flex-row');
export const ContainerFlexColumnIcon = icon('container-flex-column');
export const ContainerFlexRowReverseIcon = icon('container-flex-row-reverse');
export const ContainerFlexColumnReverseIcon = icon('container-flex-column-reverse');
export const ContainerGridRowIcon = icon('container-grid-row');
export const ContainerGridColumnIcon = icon('container-grid-column');

// Writing controls share the editor icon grid and optical sizing.
export const Heading2Icon = icon('heading-2');
export const Heading3Icon = icon('heading-3');
export const ListBulletedIcon = icon('list-bulleted');
export const ListNumberedIcon = icon('list-numbered');
export const QuoteIcon = icon('quote');
export const FormatBoldIcon = icon('format-bold');
export const FormatItalicIcon = icon('format-italic');
export const FormatStrikeIcon = icon('format-strike');
export const LayoutRatioLeftIcon = icon('layout-ratio-left');
export const LayoutRatioRightIcon = icon('layout-ratio-right');
