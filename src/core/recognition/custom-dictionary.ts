// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { parseDictionary } from "../../utils.js";
import type { PlatformProvider } from "../platform.js";

/**
 * Load the character dictionary a single `recognize()` call supplies, from a
 * path or URL or from its bytes.
 */
export async function loadCustomDictionary(
  platform: PlatformProvider,
  dictionary: string | ArrayBuffer
): Promise<string[]> {
  const bytes =
    typeof dictionary === "string"
      ? await platform.loadResource(dictionary, dictionary)
      : dictionary;
  const characters = parseDictionary(new TextDecoder("utf-8").decode(bytes));
  if (characters.length === 0) {
    throw new Error("Custom character dictionary is empty or could not be loaded.");
  }
  return characters;
}
