// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * How many bytes {@link ImageCache.generateKey} reads. Bounded so the cost stays
 * flat on large scans: a full-resolution photo reaches here as tens of megabytes
 * of raw RGBA, and hashing all of it would cost more than the OCR it saves.
 *
 * ponytail: sampled hash, not a digest of every byte - two images differing only
 * at unsampled indices still collide. Raise this, or switch to a real hash over
 * the whole buffer, if a collision is ever observed in practice.
 */
const MAX_KEY_SAMPLES = 4096;

/**
 * Simple LRU cache for processed images to avoid redundant processing
 */
export class ImageCache {
  private cache: Map<string, unknown> = new Map();
  private maxSize: number;

  constructor(maxSize = 10) {
    this.maxSize = maxSize;
  }

  /**
   * Get item from cache
   */
  get(key: string): unknown {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }

  /**
   * Set item in cache
   */
  set(key: string, value: unknown): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used item
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Generate cache key from image data
   */
  static generateKey(imageBuffer: ArrayBuffer): string {
    // Sample across the whole buffer rather than its first bytes. Canvas input
    // reaches here as raw RGBA, so two same-sized images share a length and a
    // header of uniform margin pixels; hashing only the head hands one image's
    // cached result to the other.
    const view = new Uint8Array(imageBuffer);
    if (view.length === 0) return "0_0";

    // Sample positions span the buffer end to end, so a difference in the last
    // byte counts as much as one in the first. A fixed stride would stop short
    // of the tail on any buffer that is not an exact multiple of it.
    const samples = Math.min(view.length, MAX_KEY_SAMPLES);
    const last = view.length - 1;
    let hash = 0;
    for (let k = 0; k < samples; k++) {
      const index = samples === 1 ? 0 : Math.round((k * last) / (samples - 1));
      hash = (hash << 5) - hash + (view[index] ?? 0);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${hash}_${view.length}`;
  }
}

// Global image cache instance
export const globalImageCache: ImageCache = new ImageCache();
