// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

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
    // Simple hash based on first few bytes and length
    const view = new Uint8Array(imageBuffer);
    const len = Math.min(view.length, 1024);
    let hash = 0;
    for (let i = 0; i < len; i++) {
      hash = (hash << 5) - hash + view[i];
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${hash}_${view.length}`;
  }
}

// Global image cache instance
export const globalImageCache: ImageCache = new ImageCache();
