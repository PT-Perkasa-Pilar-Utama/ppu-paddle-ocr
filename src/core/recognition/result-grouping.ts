// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { RecognitionResult } from "../base-recognition.service.js";
import type { PaddleOcrResult } from "../base-paddle-ocr.service.js";

/**
 * Converts a flat list of recognition results into line-grouped `PaddleOcrResult`.
 *
 * Items within 50% of the running average height are placed on the same line.
 */
export function groupRecognitionResultsByLine(recognition: RecognitionResult[]): PaddleOcrResult {
  const result: PaddleOcrResult = { text: "", lines: [], confidence: 0 };

  if (!recognition.length) {
    return result;
  }

  const totalConfidence = recognition.reduce((sum, r) => sum + r.confidence, 0);
  result.confidence = totalConfidence / recognition.length;

  const firstRec = recognition[0];
  if (!firstRec) return result;
  let currentLine: RecognitionResult[] = [firstRec];
  let fullText = firstRec.text;
  let avgHeight = firstRec.box.height;

  for (let i = 1; i < recognition.length; i++) {
    const current = recognition[i];
    const previous = recognition[i - 1];
    if (!current || !previous) continue;

    const verticalGap = Math.abs(current.box.y - previous.box.y);
    const threshold = avgHeight * 0.5;

    if (verticalGap <= threshold) {
      currentLine.push(current);
      fullText += ` ${current.text}`;
      avgHeight = currentLine.reduce((sum, r) => sum + r.box.height, 0) / currentLine.length;
    } else {
      result.lines.push([...currentLine]);
      fullText += `\n${current.text}`;
      currentLine = [current];
      avgHeight = current.box.height;
    }
  }

  if (currentLine.length > 0) {
    result.lines.push([...currentLine]);
  }

  result.text = fullText;
  return result;
}
