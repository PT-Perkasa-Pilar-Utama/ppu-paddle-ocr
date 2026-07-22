#!/usr/bin/env python3
"""
Quantize PP-OCR ONNX models from FP32 to INT8 dynamic quantization.

Dynamic quantization rewrites MatMul / Gemm / Conv (where supported) to use
INT8 weights + INT8 activations computed on the fly. No calibration data is
required. On modern CPUs (AVX-VNNI, ARM NEON), this typically gives:

  - Recognition: 1.8x - 2.5x faster inference
  - Detection:   1.3x - 1.8x faster inference
  - ~1% relative accuracy loss on mobile models

Run this script against the FP32 .onnx files that ship in
https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models and publish
the `_int8.onnx` output alongside the originals so ppu-paddle-ocr users can
opt in via the `model:` option.

Usage:
    pip install onnxruntime onnx
    python quantize-onnx.py path/to/model.onnx [path/to/model_int8.onnx]

If the output path is omitted, `_int8` is appended to the input basename.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process
except ImportError:
    print(
        "error: missing dependencies. Run:\n"
        "    pip install onnxruntime onnx sympy",
        file=sys.stderr,
    )
    sys.exit(1)


def quantize(input_path: Path, output_path: Path) -> None:
    if not input_path.is_file():
        raise FileNotFoundError(f"input model not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # ONNX Runtime's quantizer requires static shapes on the graph to decide
    # which ops can be quantized. `quant_pre_process` runs shape inference
    # and symbolic shape resolution to prepare the model. Skipping this step
    # causes the quantizer to silently leave many ops in FP32, which is why
    # the first-pass output can end up the same size as the input.
    preproc_path = output_path.with_suffix(".preproc.onnx")
    print(f"→ preprocessing {input_path} -> {preproc_path}")
    quant_pre_process(
        input_model=str(input_path),
        output_model_path=str(preproc_path),
        skip_optimization=False,
        skip_onnx_shape=False,
        skip_symbolic_shape=False,
    )

    print(f"→ quantizing {preproc_path} -> {output_path}")

    quantize_dynamic(
        model_input=str(preproc_path),
        model_output=str(output_path),
        # QInt8 works on most CPUs; QUInt8 can be faster on older Intel but
        # wider support tends to favour QInt8 across arm64 / x86-64.
        weight_type=QuantType.QInt8,
        # Per-channel weights give noticeably better accuracy at the cost
        # of ~1-3% extra file size. Recommended for OCR models.
        per_channel=True,
        # Restrict to MatMul/Gemm only. Dynamic quantization of Conv produces
        # `ConvInteger` nodes that are NOT supported by the CPU EP in
        # `onnxruntime-node` (the binding we ship with), so quantized-Conv
        # models fail to load with:
        #   "Could not find an implementation for ConvInteger(10)"
        # SVTR-based recognition is dominated by MatMul compute in the
        # transformer body anyway, so this still delivers most of the win.
        # Detection models can largely be left FP32 - they're a small
        # fraction of end-to-end time and don't quantize cleanly here.
        op_types_to_quantize=["MatMul", "Gemm"],
        # reduce_range=True constrains activations to 7-bit to avoid int8
        # overflow on older AVX2 CPUs. Leave False on modern hardware.
        reduce_range=False,
    )

    # Clean up the intermediate preproc model - it's only useful as a
    # debugging artefact.
    try:
        preproc_path.unlink()
    except OSError:
        pass

    # Smoke check: load the quantized model and print size delta.
    try:
        onnx.checker.check_model(str(output_path))
    except Exception as exc:  # pragma: no cover - diagnostic path
        print(f"warning: onnx.checker raised on output: {exc}", file=sys.stderr)

    in_kb = input_path.stat().st_size / 1024
    out_kb = output_path.stat().st_size / 1024
    print(f"  {in_kb:,.1f} KiB -> {out_kb:,.1f} KiB ({out_kb / in_kb:.2%} of original)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("input", type=Path, help="Path to FP32 .onnx model")
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        default=None,
        help="Path for quantized output (default: <input>_int8.onnx)",
    )
    args = parser.parse_args()

    if args.output is None:
        stem = args.input.stem
        args.output = args.input.with_name(f"{stem}_int8.onnx")

    try:
        quantize(args.input, args.output)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
