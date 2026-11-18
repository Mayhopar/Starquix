import { Media1Icon, Media2Icon, Media3Icon } from './index';

/** 1 / 2 / 3 media — the count controls everywhere (post editor + DesignBar). Kept out of index.ts: that module exports icons only. */
export const MEDIA_COUNT_ICONS = [Media1Icon, Media2Icon, Media3Icon] as const;
