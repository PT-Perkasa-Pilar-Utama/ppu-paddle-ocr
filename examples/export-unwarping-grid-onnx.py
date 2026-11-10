#!/usr/bin/env python3
"""
Cut PaddleOCR's UVDoc document unwarping model so it returns the deformation
grid instead of a corrected image.

The stock graph (correction/UVDoc.onnx in ppu-paddle-ocr-models, exported from
PaddlePaddle's UVDoc, Apache-2.0) does three things in one run:

    image [N,3,H,W] -> Resize to 712x488 -> network -> grid [N,2,45,31]
                    -> Resize grid to HxW -> GridSample(image, grid) -> image

ppu-paddle-ocr needs the grid itself: it maps text boxes back to the photo,
checks the grid before applying it, and redraws the page at its own size. This
script keeps only the network:

    image [1,3,712,488] -> network -> grid [1,2,45,31]

The weights are unchanged. What is removed is the input Resize, the grid
Resize, and GridSample, which also makes the model's input a fixed 4.2 MB
tensor (3 * 712 * 488 * 4 bytes) whatever the photo size, and leaves only
Conv, Relu, PRelu, Add, Concat, Pad, Squeeze, and Unsqueeze nodes.

The caller must now do what the removed input Resize did: scale the photo to
488x712 with bilinear interpolation and aligned corners, channels in B, G, R
order, values divided by 255 (see src/core/unwarping/image-tensor.ts).

Usage:
    pip install onnx
    python export-unwarping-grid-onnx.py UVDoc.onnx UVDoc_grid.onnx

Publish the output as correction/UVDoc_grid.onnx next to the original; that
path is UNWARPING_MODEL_URL in src/model-catalogue.ts.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import onnx
from onnx import TensorProto, helper
from onnx.utils import Extractor

# Tensor names in the stock graph. They come from the Paddle2ONNX export, so a
# re-export of UVDoc can rename them; the checks below fail loudly if it does.
NETWORK_INPUT = "p2o.pd_op.bilinear_interp.0.0"
NETWORK_GRID = "p2o.pd_op.add.41.0"

INPUT_SHAPE = [1, 3, 712, 488]
GRID_SHAPE = [1, 2, 45, 31]


def cut(source: Path, target: Path) -> None:
    model = onnx.load(str(source))
    produced = {output for node in model.graph.node for output in node.output}
    for name in (NETWORK_INPUT, NETWORK_GRID):
        if name not in produced:
            sys.exit(
                f"{source}: tensor {name!r} not found. The graph is not the stock "
                "UVDoc export this script was written against."
            )

    network = Extractor(model).extract_model([NETWORK_INPUT], [NETWORK_GRID])
    graph = network.graph
    for node in graph.node:
        node.input[:] = ["image" if name == NETWORK_INPUT else name for name in node.input]
        node.output[:] = ["grid" if name == NETWORK_GRID else name for name in node.output]

    del graph.input[:]
    del graph.output[:]
    del graph.value_info[:]
    graph.input.append(helper.make_tensor_value_info("image", TensorProto.FLOAT, INPUT_SHAPE))
    graph.output.append(helper.make_tensor_value_info("grid", TensorProto.FLOAT, GRID_SHAPE))
    network.producer_name = "ppu-paddle-ocr"
    network.doc_string = (
        "UVDoc (PaddlePaddle, Apache-2.0) cut to output the deformation grid. "
        "Modified by ppu-paddle-ocr: input Resize, grid Resize and GridSample removed."
    )

    onnx.checker.check_model(network)
    onnx.save(network, str(target))

    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    print(f"wrote {target} ({target.stat().st_size} bytes, {len(graph.node)} nodes)")
    print(f"sha256 {digest}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=Path, help="stock UVDoc.onnx")
    parser.add_argument("target", type=Path, help="output path, e.g. UVDoc_grid.onnx")
    args = parser.parse_args()
    cut(args.source, args.target)


if __name__ == "__main__":
    main()
