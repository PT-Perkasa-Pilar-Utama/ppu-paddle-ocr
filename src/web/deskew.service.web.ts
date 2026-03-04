import { Contours, ImageProcessor, cv, type CanvasLike } from "ppu-ocv/web";
import {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
} from "../constants.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";

export class DeskewServiceWeb {
  private readonly options: DetectionOptions;
  private readonly debugging: DebuggingOptions;
  constructor(
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    this.options = {
      ...DEFAULT_DETECTION_OPTIONS,
      ...options,
    };

    this.debugging = {
      ...DEFAULT_DEBUGGING_OPTIONS,
      ...debugging,
    };
  }

  private log(message: string): void {
    if (this.debugging.verbose) {
      console.log(`[DeskewServiceWeb] ${message}`);
    }
  }

  async calculateSkewAngle(probabilityMapCanvas: CanvasLike): Promise<number> {
    const processor = new ImageProcessor(probabilityMapCanvas);
    const mat = processor
      .grayscale()
      .threshold({
        lower: 0,
        upper: 255,
        type: cv.THRESH_BINARY + cv.THRESH_OTSU,
      })
      .toMat();

    const contours = new Contours(mat, {
      mode: cv.RETR_LIST,
      method: cv.CHAIN_APPROX_SIMPLE,
    });

    processor.destroy();

    const minAngle = -20;
    const maxAngle = 20;
    const minArea = this.options.minimumAreaThreshold || 20;

    const textRegions: Array<{
      rect: { x: number; y: number; width: number; height: number };
      contour: any;
      area: number;
      aspectRatio: number;
    }> = [];

    contours.iterate((contour: any) => {
      const rect = contours.getRect(contour);
      const area = rect.width * rect.height;

      if (area < minArea) return;

      const aspectRatio = rect.width / rect.height;

      if (aspectRatio > 0.2 && aspectRatio < 10) {
        textRegions.push({
          rect,
          contour,
          area,
          aspectRatio,
        });
      }
    });

    if (textRegions.length === 0) {
      this.log("No valid text regions found for skew calculation.");
      contours.destroy();
      return 0;
    }

    const averageHeight =
      textRegions.reduce((sum, region) => sum + region.rect.height, 0) /
      textRegions.length;

    const filteredRegions = textRegions.filter((region) => {
      return region.rect.height <= averageHeight * 1.5;
    });

    this.log(`Found ${filteredRegions.length} text regions for skew analysis.`);

    const minRectAngles = this.calculateMinRectAngles(filteredRegions);
    const baselineAngles = this.calculateBaselineAngles(filteredRegions);
    const houghAngles = this.calculateHoughAngles(mat, minAngle, maxAngle);

    contours.destroy();
    const allAngles: Array<{ angle: number; weight: number; method: string }> =
      [
        ...minRectAngles.map((a) => ({ ...a, method: "minRect" })),
        ...baselineAngles.map((a) => ({ ...a, method: "baseline" })),
        ...houghAngles.map((a) => ({ ...a, method: "hough" })),
      ];

    if (allAngles.length === 0) {
      this.log("No angles detected from any method.");
      return 0;
    }

    const consensusAngle = this.calculateConsensusAngle(
      allAngles,
      minAngle,
      maxAngle,
    );

    this.log(
      `Calculated skew angle: ${consensusAngle.toFixed(3)}° (from ${
        allAngles.length
      } measurements)`,
    );

    return consensusAngle;
  }

  private calculateMinRectAngles(
    textRegions: any[],
  ): Array<{ angle: number; weight: number }> {
    const angles: Array<{ angle: number; weight: number }> = [];

    for (const region of textRegions) {
      try {
        const minRect = cv.minAreaRect(region.contour);
        if (!minRect) continue;

        let angle = minRect.angle;

        if (angle > 45) {
          angle -= 90;
        } else if (angle < -45) {
          angle += 90;
        }

        const areaWeight = Math.log(region.area + 1);
        const aspectWeight =
          Math.min(region.aspectRatio, 1 / region.aspectRatio) * 2;
        const weight = areaWeight * aspectWeight;

        angles.push({ angle, weight });
      } catch (error) {
        continue;
      }
    }

    return angles;
  }

  private calculateBaselineAngles(
    textRegions: any[],
  ): Array<{ angle: number; weight: number }> {
    const angles: Array<{ angle: number; weight: number }> = [];

    for (const region of textRegions) {
      try {
        const points = region.contour.data32S;
        if (!points || points.length < 8) continue;

        const bottomPoints: Array<{ x: number; y: number }> = [];

        for (let i = 0; i < points.length; i += 2) {
          const x = points[i];
          const y = points[i + 1];
          if (x !== undefined && y !== undefined) {
            bottomPoints.push({ x, y });
          }
        }

        if (bottomPoints.length < 3) continue;
        bottomPoints.sort((a, b) => a.x - b.x);

        const segments = 3;
        const segmentSize = Math.floor(bottomPoints.length / segments);
        const baselinePoints: Array<{ x: number; y: number }> = [];

        for (let seg = 0; seg < segments; seg++) {
          const start = seg * segmentSize;
          const end =
            seg === segments - 1
              ? bottomPoints.length
              : (seg + 1) * segmentSize;
          const segmentPoints = bottomPoints.slice(start, end);

          if (segmentPoints.length > 0) {
            const maxYPoint = segmentPoints.reduce((max, point) =>
              point.y > max.y ? point : max,
            );
            baselinePoints.push(maxYPoint);
          }
        }

        if (baselinePoints.length >= 2) {
          const angle = this.calculateLineAngle(baselinePoints);
          const weight =
            region.area * Math.min(region.aspectRatio, 1 / region.aspectRatio);

          angles.push({ angle, weight });
        }
      } catch (error) {
        continue;
      }
    }

    return angles;
  }

  private calculateHoughAngles(
    mat: any,
    minAngle: number,
    maxAngle: number,
  ): Array<{ angle: number; weight: number }> {
    const angles: Array<{ angle: number; weight: number }> = [];

    try {
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 1));
      const morphed = new cv.Mat();
      cv.morphologyEx(mat, morphed, cv.MORPH_CLOSE, kernel);

      const lines = new cv.Mat();
      cv.HoughLinesP(morphed, lines, 1, Math.PI / 180, 30, 50, 10);

      for (let i = 0; i < lines.rows; i++) {
        const line = lines.data32S.subarray(i * 4, (i + 1) * 4);
        const [x1, y1, x2, y2] = line;

        if (
          x1 !== undefined &&
          y1 !== undefined &&
          x2 !== undefined &&
          y2 !== undefined
        ) {
          const dx = x2 - x1;
          const dy = y2 - y1;

          if (Math.abs(dx) > 1) {
            let angle = (Math.atan2(dy, dx) * 180) / Math.PI;

            if (angle > 45) angle -= 90;
            if (angle < -45) angle += 90;

            if (angle >= minAngle && angle <= maxAngle) {
              const lineLength = Math.sqrt(dx * dx + dy * dy);
              angles.push({ angle, weight: lineLength });
            }
          }
        }
      }

      morphed.delete();
      lines.delete();
      kernel.delete();
    } catch (error) {
      this.log("Hough transform failed, skipping this method.");
    }

    return angles;
  }

  private calculateLineAngle(points: Array<{ x: number; y: number }>): number {
    if (points.length < 2) return 0;

    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);

    const denominator = n * sumXX - sumX * sumX;

    if (Math.abs(denominator) < 1e-10) return 0;

    const slope = (n * sumXY - sumX * sumY) / denominator;
    let angle = (Math.atan(slope) * 180) / Math.PI;

    if (angle > 45) angle -= 90;
    if (angle < -45) angle += 90;

    return angle;
  }

  private calculateConsensusAngle(
    angles: Array<{ angle: number; weight: number; method: string }>,
    minAngle: number,
    maxAngle: number,
  ): number {
    if (angles.length === 0) return 0;

    const sortedAngles = [...angles].sort((a, b) => a.angle - b.angle);
    const q1Index = Math.floor(sortedAngles.length * 0.25);
    const q3Index = Math.floor(sortedAngles.length * 0.75);

    const q1 = sortedAngles[q1Index]?.angle || 0;
    const q3 = sortedAngles[q3Index]?.angle || 0;
    const iqr = q3 - q1;

    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const filteredAngles = angles.filter(
      (a) =>
        a.angle >= lowerBound &&
        a.angle <= upperBound &&
        a.angle >= minAngle &&
        a.angle <= maxAngle,
    );

    if (filteredAngles.length === 0) {
      this.log(
        "All angles filtered out as outliers, using median of original set.",
      );
      const medianIndex = Math.floor(sortedAngles.length / 2);
      return sortedAngles[medianIndex]?.angle || 0;
    }

    const totalWeight = filteredAngles.reduce((sum, a) => sum + a.weight, 0);

    if (totalWeight === 0) {
      const average =
        filteredAngles.reduce((sum, a) => sum + a.angle, 0) /
        filteredAngles.length;
      return average;
    }

    const weightedSum = filteredAngles.reduce(
      (sum, a) => sum + a.angle * a.weight,
      0,
    );
    const weightedAverage = weightedSum / totalWeight;

    const methodCounts = filteredAngles.reduce(
      (counts, a) => {
        counts[a.method] = (counts[a.method] || 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );

    this.log(
      `Angle methods used: ${Object.entries(methodCounts)
        .map(([method, count]) => `${method}:${count}`)
        .join(", ")}`,
    );

    return Math.max(minAngle, Math.min(maxAngle, weightedAverage));
  }
}
