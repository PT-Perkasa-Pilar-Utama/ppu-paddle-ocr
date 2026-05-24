// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { Contours, cv } from "ppu-ocv";
import type { Box } from "../../interface.js";

/**
 * Calculates resize dimensions keeping the longest side at or below `maxSideLength`.
 *
 * Returns the new dimensions and the scale ratio applied.
 */
export function calculateResizeDimensions(
  originalWidth: number,
  originalHeight: number,
  maxSideLength: number
): { width: number; height: number; ratio: number } {
  let resizeW = originalWidth;
  let resizeH = originalHeight;
  let ratio = 1.0;

  if (Math.max(resizeH, resizeW) > maxSideLength) {
    ratio = maxSideLength / (resizeH > resizeW ? resizeH : resizeW);
    resizeW = Math.round(resizeW * ratio);
    resizeH = Math.round(resizeH * ratio);
  }

  return { width: resizeW, height: resizeH, ratio };
}

/**
 * Expands a bounding rect by padding derived from its height, clamped to canvas bounds.
 */
export function applyPaddingToRect(
  rect: { x: number; y: number; width: number; height: number },
  maxWidth: number,
  maxHeight: number,
  paddingVertical: number,
  paddingHorizontal: number
): { x: number; y: number; width: number; height: number } {
  const verticalPadding = Math.round(rect.height * paddingVertical);
  const horizontalPadding = Math.round(rect.height * paddingHorizontal);

  let x = rect.x - horizontalPadding;
  let y = rect.y - verticalPadding;

  x = Math.max(0, x);
  y = Math.max(0, y);

  const rightEdge = Math.min(maxWidth, rect.x + rect.width + horizontalPadding);
  const bottomEdge = Math.min(maxHeight, rect.y + rect.height + verticalPadding);
  const width = rightEdge - x;
  const height = bottomEdge - y;

  return { x, y, width, height };
}

/**
 * Maps a rect from the resized/padded tensor space back to original image coordinates.
 */
export function convertToOriginalCoordinates(
  rect: { x: number; y: number; width: number; height: number },
  resizeRatio: number,
  originalWidth: number,
  originalHeight: number
): Box {
  const scaledX = rect.x / resizeRatio;
  const scaledY = rect.y / resizeRatio;
  const scaledWidth = rect.width / resizeRatio;
  const scaledHeight = rect.height / resizeRatio;

  const x = Math.max(0, Math.round(scaledX));
  const y = Math.max(0, Math.round(scaledY));
  const width = Math.min(originalWidth - x, Math.round(scaledWidth));
  const height = Math.min(originalHeight - y, Math.round(scaledHeight));

  return { x, y, width, height };
}

/**
 * Iterates OpenCV contours and converts each to a padded, coordinate-mapped `Box`.
 */
export function extractBoxesFromContours(
  contours: Contours,
  width: number,
  height: number,
  resizeRatio: number,
  originalWidth: number,
  originalHeight: number,
  minBoxArea: number,
  paddingVertical: number,
  paddingHorizontal: number
): Box[] {
  const boxes: Box[] = [];

  contours.iterate((contour: cv.Mat) => {
    const rect = contours.getRect(contour);

    if (rect.width * rect.height <= minBoxArea) {
      return;
    }

    const paddedRect = applyPaddingToRect(rect, width, height, paddingVertical, paddingHorizontal);
    const finalBox = convertToOriginalCoordinates(
      paddedRect,
      resizeRatio,
      originalWidth,
      originalHeight
    );

    if (finalBox.width > 5 && finalBox.height > 5) {
      boxes.push(finalBox);
    }
  });

  return boxes;
}

/**
 * Converts raw region bboxes from `findRegions` into `Box` objects clamped to the original image.
 */
export function extractBoxesFromRegions(
  regions: Array<{
    bbox: { x0: number; y0: number; x1: number; y1: number };
    area: number;
  }>,
  originalWidth: number,
  originalHeight: number
): Box[] {
  const boxes: Box[] = [];

  for (const region of regions) {
    const { bbox } = region;

    const box: Box = {
      x: Math.max(0, bbox.x0),
      y: Math.max(0, bbox.y0),
      width: bbox.x1 - bbox.x0,
      height: bbox.y1 - bbox.y0,
    };

    if (box.x + box.width > originalWidth) {
      box.width = originalWidth - box.x;
    }
    if (box.y + box.height > originalHeight) {
      box.height = originalHeight - box.y;
    }

    if (box.width > 5 && box.height > 5) {
      boxes.push(box);
    }
  }

  return boxes;
}
