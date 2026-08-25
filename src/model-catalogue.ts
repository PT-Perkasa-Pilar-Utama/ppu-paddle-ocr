// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/** Shape shared by all built-in model URL constants. */
export type ModelUrls = Readonly<{
  detection: string;
  recognition: string;
  charactersDictionary: string;
}>;

/**
 * Base URL for model files.
 *
 * The Hugging Face mirror of
 * https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models. It serves
 * from a CDN with no Git LFS bandwidth budget behind it, which the GitHub
 * copies have and can exhaust, cutting off downloads for every version at
 * once. Paths are identical on both hosts, so only the base differs.
 */
export const MODEL_BASE_URL = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";
/**
 * Base URL for dictionary files.
 *
 * Same host as {@link MODEL_BASE_URL}; kept separate because it is a public
 * export and callers build URLs from it. On GitHub the two differed, since
 * models came from the LFS media host and dictionaries from raw.
 */
export const DICT_BASE_URL = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";

// ─── PP-OCRv6 Models ──────────────────────────────────────────────────────────

/** PP-OCRv6 small: 50+ languages full dictionary, best accuracy/speed balance. */
export const V6_SMALL_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/ort/PP-OCRv6_small_det.ort`,
  recognition: `${MODEL_BASE_URL}/recognition/ort/PP-OCRv6_small_rec.ort`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv6_dict.txt`,
};

/** PP-OCRv6 medium: Server-grade, +5.1% accuracy vs v5 server. */
export const V6_MEDIUM_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/ort/PP-OCRv6_medium_det.ort`,
  recognition: `${MODEL_BASE_URL}/recognition/ort/PP-OCRv6_medium_rec.ort`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv6_dict.txt`,
};

/** PP-OCRv6 tiny (default): fastest, ~6.9k-char dictionary (drops rare CJK, kana). */
export const V6_TINY_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/ort/PP-OCRv6_tiny_det.ort`,
  recognition: `${MODEL_BASE_URL}/recognition/ort/PP-OCRv6_tiny_rec.ort`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv6_tiny_dict.txt`,
};

// ─── PP-OCRv5 Models ──────────────────────────────────────────────────────────

/** PP-OCRv5 English mobile. */
export const V5_EN_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.ort`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
};

/** PP-OCRv5 English mobile with INT8 quantization. */
export const V5_EN_MOBILE_INT8_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.ort`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer_int8.ort`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
};

/** PP-OCRv5 English server. */
export const V5_EN_SERVER_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_server_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv5_server_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv5_dict.txt`,
};

/** PP-OCRv5 mobile. */
export const V5_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv5_dict.txt`,
};

/** PP-OCRv5 server. */
export const V5_SERVER_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_server_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv5_server_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv5_dict.txt`,
};

// ─── PP-OCRv4 Models ──────────────────────────────────────────────────────────

/** PP-OCRv4 English mobile. */
export const V4_EN_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv4_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/en/v4/en_PP-OCRv4_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/en/v4/en_dict.txt`,
};

/** PP-OCRv4 mobile. */
export const V4_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv4_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv4_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv4_dict.txt`,
};

/** PP-OCRv4 server. */
export const V4_SERVER_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv4_server_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv4_server_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv4_dict.txt`,
};

/** PP-OCRv4 server for documents. */
export const V4_SERVER_DOC_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv4_server_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv4_server_rec_doc_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv4_doc_dict.txt`,
};

// ─── PP-OCRv3 Models ──────────────────────────────────────────────────────────
//
// No PP-OCRv3 detection model is published, so the v3 recognition models are
// paired with the PP-OCRv5 mobile detector. Detection is generation-agnostic
// (DB-based) and works fine across versions; only the recognition head is v3.

/** PP-OCRv3 mobile recognition (paired with the v5 mobile detector - see note above). */
export const V3_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/PP-OCRv3_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/ppocrv3_dict.txt`,
};

/** PP-OCRv3 Japanese mobile recognition (paired with the v5 mobile detector - see note above). */
export const V3_JAPANESE_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/japan/v3/japan_PP-OCRv3_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/japan/v3/japan_dict.txt`,
};

// ─── Multilingual v5 Models ───────────────────────────────────────────────────

/** PP-OCRv5 Arabic mobile. */
export const V5_ARABIC_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/arabic/v5/arabic_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/arabic/v5/ppocrv5_arabic_dict.txt`,
};

/** PP-OCRv5 Cyrillic mobile. */
export const V5_CYRILLIC_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt`,
};

/** PP-OCRv5 Devanagari mobile. */
export const V5_DEVANAGARI_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/devanagari/v5/devanagari_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/devanagari/v5/ppocrv5_devanagari_dict.txt`,
};

/** PP-OCRv5 Greek mobile. */
export const V5_GREEK_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/el/v5/el_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/el/v5/ppocrv5_el_dict.txt`,
};

/** PP-OCRv5 Eslav mobile. */
export const V5_ESLAV_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/eslav/v5/eslav_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/eslav/v5/ppocrv5_eslav_dict.txt`,
};

/** PP-OCRv5 Korean mobile. */
export const V5_KOREAN_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/korean/v5/korean_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/korean/v5/ppocrv5_korean_dict.txt`,
};

/** PP-OCRv5 Latin mobile. */
export const V5_LATIN_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt`,
};

/** PP-OCRv5 Tamil mobile. */
export const V5_TAMIL_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/ta/v5/ta_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/ta/v5/ppocrv5_ta_dict.txt`,
};

/** PP-OCRv5 Telugu mobile. */
export const V5_TELUGU_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/te/v5/te_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/te/v5/ppocrv5_te_dict.txt`,
};

/** PP-OCRv5 Thai mobile. */
export const V5_THAI_MOBILE_MODEL: ModelUrls = {
  detection: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${MODEL_BASE_URL}/recognition/multi/th/v5/th_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DICT_BASE_URL}/recognition/multi/th/v5/ppocrv5_th_dict.txt`,
};

/** Default model (PP-OCRv6 tiny): fastest, tuned by DEFAULT_DETECTION_OPTIONS. */
export const DEFAULT_MODEL: ModelUrls = V6_TINY_MODEL;

/** @deprecated Use {@link DEFAULT_MODEL} instead. */
export const DEFAULT_MODEL_URLS: ModelUrls = DEFAULT_MODEL;

/** Valid preset key for {@link MODEL_PRESETS}. */
export type ModelPreset =
  | "v6-small"
  | "v6-medium"
  | "v6-tiny"
  | "v5-en-mobile"
  | "v5-en-mobile-int8"
  | "v5-en-server"
  | "v5-mobile"
  | "v5-server"
  | "v5-arabic-mobile"
  | "v5-cyrillic-mobile"
  | "v5-devanagari-mobile"
  | "v5-greek-mobile"
  | "v5-eslav-mobile"
  | "v5-korean-mobile"
  | "v5-latin-mobile"
  | "v5-tamil-mobile"
  | "v5-telugu-mobile"
  | "v5-thai-mobile"
  | "v4-en-mobile"
  | "v4-mobile"
  | "v4-server"
  | "v4-server-doc"
  | "v3-mobile"
  | "v3-japanese-mobile";

/**
 * Kebab-case preset keys mapped to their model URL bundle, for name-based
 * selection (e.g. the CLI `--model` flag). Mirrors the exported `*_MODEL`
 * constants one-to-one.
 */
// `satisfies` is the rule's preferred form, but isolatedDeclarations (required
// for the d.ts emit) cannot infer this literal's type, so the annotation stays.
// oxlint-disable-next-line anti-slop/no-known-value-widening
export const MODEL_PRESETS: Readonly<Record<ModelPreset, ModelUrls>> = {
  "v6-small": V6_SMALL_MODEL,
  "v6-medium": V6_MEDIUM_MODEL,
  "v6-tiny": V6_TINY_MODEL,
  "v5-en-mobile": V5_EN_MOBILE_MODEL,
  "v5-en-mobile-int8": V5_EN_MOBILE_INT8_MODEL,
  "v5-en-server": V5_EN_SERVER_MODEL,
  "v5-mobile": V5_MOBILE_MODEL,
  "v5-server": V5_SERVER_MODEL,
  "v5-arabic-mobile": V5_ARABIC_MOBILE_MODEL,
  "v5-cyrillic-mobile": V5_CYRILLIC_MOBILE_MODEL,
  "v5-devanagari-mobile": V5_DEVANAGARI_MOBILE_MODEL,
  "v5-greek-mobile": V5_GREEK_MOBILE_MODEL,
  "v5-eslav-mobile": V5_ESLAV_MOBILE_MODEL,
  "v5-korean-mobile": V5_KOREAN_MOBILE_MODEL,
  "v5-latin-mobile": V5_LATIN_MOBILE_MODEL,
  "v5-tamil-mobile": V5_TAMIL_MOBILE_MODEL,
  "v5-telugu-mobile": V5_TELUGU_MOBILE_MODEL,
  "v5-thai-mobile": V5_THAI_MOBILE_MODEL,
  "v4-en-mobile": V4_EN_MOBILE_MODEL,
  "v4-mobile": V4_MOBILE_MODEL,
  "v4-server": V4_SERVER_MODEL,
  "v4-server-doc": V4_SERVER_DOC_MODEL,
  "v3-mobile": V3_MOBILE_MODEL,
  "v3-japanese-mobile": V3_JAPANESE_MOBILE_MODEL,
};
