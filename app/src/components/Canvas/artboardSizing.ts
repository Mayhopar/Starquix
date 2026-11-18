import type { ContentHeightPayload } from '@/bridge/types';

/** Fits content without letting vh-dependent pages grow the iframe forever.
 * The bridge pins vh to the design viewport (vh-pin.ts), so a fit normally
 * converges; a fit that still diverges (inline vh, JS innerHeight) freezes at
 * the FALLBACK (the design viewport height) and shows the first screen —
 * design mode never scrolls. The fallback (the design SCREEN height) is also
 * the floor: an empty or short page still shows one full screen.
 * DOM revisions or settled independent geometry renew automatic fitting.
 */
export class ArtboardSizing {
  height: number;
  private previous?: ContentHeightPayload;
  private adjustments = 0;
  private divergentSteps = 0;
  private frozen = false;
  private retiredDocuments = new Set<string>();

  constructor(private fallback: number) { this.height = fallback; }

  /** The last accepted content measurement (0 before any) — the height without the screen floor. */
  get contentHeight(): number { return Math.ceil(this.previous?.height ?? 0); }

  /** A fallback change renews iterations, never document freshness. */
  setFallback(fallback: number): void {
    this.fallback = fallback;
    this.height = Math.max(fallback, Math.ceil(this.previous?.height ?? fallback));
    this.adjustments = 0;
    this.divergentSteps = 0;
    this.frozen = false;
  }


  measure(sample: ContentHeightPayload): number {
    if (!Number.isFinite(sample.height) || sample.height <= 0) return this.height;
    if (sample.viewportHeight !== undefined && sample.viewportHeight !== this.height) return this.height;
    const previous = this.previous;
    if (sample.documentId && this.retiredDocuments.has(sample.documentId)) return this.height;
    const newDocument = sample.documentId !== previous?.documentId;
    if (!newDocument && sample.revision !== undefined && previous?.revision !== undefined && sample.revision < previous.revision) return this.height;
    if (newDocument && previous?.documentId) this.retiredDocuments.add(previous.documentId);
    const hasViewport = sample.viewportHeight !== undefined && previous?.viewportHeight !== undefined;
    const resized = hasViewport && sample.viewportHeight !== previous.viewportHeight;
    const contentChanged = !previous || newDocument || sample.revision !== previous.revision ||
      (!resized && !sample.transitioning && !previous.transitioning && sample.height !== previous.height);
    if (contentChanged) {
      this.adjustments = 0;
      this.divergentSteps = 0;
      this.frozen = false;
    }
    this.previous = sample;
    const target = Math.max(this.fallback, Math.ceil(sample.height));
    if (target === this.height || this.frozen) return this.height;
    if (resized && !contentChanged) {
      const overflow = sample.height - sample.viewportHeight!;
      const previousOverflow = previous.height - previous.viewportHeight!;
      this.divergentSteps = overflow > 0 && overflow >= previousOverflow - 0.5
        ? this.divergentSteps + 1 : 0;
      if (this.divergentSteps >= 2 || this.adjustments >= 8) {
        this.frozen = true;
        this.height = this.fallback;
        return this.height;
      }
    }
    this.adjustments++;
    this.height = target;
    return this.height;
  }
}
