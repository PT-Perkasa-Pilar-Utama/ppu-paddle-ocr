# Fine-tune PP-OCRv6 recognition for your domain

Starter kit for fine-tuning the PP-OCRv6 recognition models on your own labeled word crops, then loading the result back into `ppu-paddle-ocr`. Copy this folder, pick a model tier, drop your dataset in, train.

Fine-tuning pays off when stock accuracy on _your_ documents is limited by domain quirks; dropped inter-word spaces, unusual fonts, dot-matrix print, ID-card hatching, rather than by image quality. Recognition only: the detector generalizes well and rarely needs fine-tuning.

## 1. Pick a tier

**Each tier has its own config, they are not interchangeable.** The tiers differ in backbone size, CTC neck (`reshape` vs `lightsvtr` at different widths), NRTR head width, and dictionary (tiny uses the pruned ~6.9k-char dict, small/medium the full one):

| Tier   | Config                               | Dictionary              | Pick when                                        |
| ------ | ------------------------------------ | ----------------------- | ------------------------------------------------ |
| tiny   | `configs/PP-OCRv6_tiny_rec_ft.yml`   | `ppocrv6_tiny_dict.txt` | You run the ppu-paddle-ocr default (most users)  |
| small  | `configs/PP-OCRv6_small_rec_ft.yml`  | `ppocrv6_dict.txt`      | You serve `V6_SMALL_MODEL` / need rare CJK, kana |
| medium | `configs/PP-OCRv6_medium_rec_ft.yml` | `ppocrv6_dict.txt`      | You serve `V6_MEDIUM_MODEL` (server-grade)       |

Fine-tune the tier you actually serve, accuracy gains do not transfer between tiers.

## 2. Prepare the dataset

Layout this kit expects (PaddleOCR SimpleDataSet format, tab-separated):

```
dataset/
  train/…png   train.txt   ->  train/word_0.png<TAB>RECEIPT ID
  val/…png     val.txt
  test/…png    test.txt    (held out; never seen during training)
```

Rules that decide your limitation:

- Labels must transcribe the **pixels** exactly, printed case, punctuation, spacing, not the canonical value from your database.
- Drop crops the detector truncated instead of guessing the missing text.
- Labels longer than the config's `max_text_length` (40 here) are silently dropped by PaddleOCR, check your longest label.

If you have full-page images with line-level ground truth, generate the dataset automatically:

```bash
bun examples/fine-tune/prepare-dataset.ts <image> <ground-truth.txt> <out-dir>
```

It detects boxes, reads each crop, aligns the reading against your ground truth (labels always come from the ground truth), snaps to word boundaries, skips anything it cannot verify, and splits 70/15/15. Run it once per image with a different `<out-dir>`, or merge list files afterwards.

The bundled sample dataset in `dataset/` was produced from `assets/receipt.jpg` + `assets/receipt-ground-truth.txt` by running it with no arguments, replace it with your data (a real fine-tune wants thousands of crops, not 23).

## 3. Train

```bash
git clone https://github.com/PaddlePaddle/PaddleOCR
cd PaddleOCR && pip install -r requirements.txt   # plus paddlepaddle-gpu

# put the kit at the repo root (paths in the configs assume ./fine-tune/)
cp -r /path/to/this/folder ./fine-tune

# pretrained weights for your tier (tiny shown)
mkdir -p fine-tune/pretrained && wget -P fine-tune/pretrained \
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv6_tiny_rec_pretrained.pdparams

python tools/train.py -c fine-tune/configs/PP-OCRv6_tiny_rec_ft.yml
```

Watch the `eval acc` lines (val set, spaces counted — these configs set `ignore_space: false` so checkpoint selection cares about spacing). The best checkpoint is saved continuously; stop early if it plateaus.

Final check on the held-out test split:

```bash
python tools/eval.py -c fine-tune/configs/PP-OCRv6_tiny_rec_ft.yml \
  -o Global.checkpoints=fine-tune/output/tiny/best_accuracy \
     Eval.dataset.label_file_list=[fine-tune/dataset/test.txt]
```

## 4. Export and convert

```bash
python tools/export_model.py -c fine-tune/configs/PP-OCRv6_tiny_rec_ft.yml \
  -o Global.checkpoints=fine-tune/output/tiny/best_accuracy \
     Global.save_inference_dir=fine-tune/output/tiny_infer
```

> On PaddlePaddle < 3.0 this fails with a bare `AssertionError` in
> `export_single_model`: the default export format (PIR) needs paddle >= 3.0.
> Append `Global.export_with_pir=False` to the `-o` list to export the classic
> format instead — everything downstream works with either.

Convert to ONNX:

```bash
pip install paddle2onnx
paddle2onnx --model_dir fine-tune/output/tiny_infer \
  --model_filename inference.pdmodel \
  --params_filename inference.pdiparams \
  --save_file fine-tune/output/tiny_rec.onnx \
  --opset_version 14 \
  --enable_onnx_checker True
```

`--model_filename` is `inference.pdmodel` for the classic format, `inference.json`
for PIR exports.

> paddle2onnx 2.x refuses to run against paddle < 3.0 (`ValueError: The
paddlepaddle version should not be less than 3.0.0...`). If you trained on
> paddle 2.x, swap to a CPU paddle 3 for this one step — training and export
> are already done, and conversion does not need a GPU:
> `pip uninstall -y paddlepaddle-gpu paddlepaddle && pip install paddlepaddle==3.0.0 paddle2onnx`

See [`examples/convert-onnx.ipynb`](../convert-onnx.ipynb) for optional INT8
quantization and `.ort` packaging.

## 5. Load it in ppu-paddle-ocr

```ts
const service = new PaddleOcrService({
  model: {
    recognition: "./models/my_finetuned_rec.onnx",
    // same dict your tier trained with — tiny shown:
    charactersDictionary:
      "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt",
  },
});
```

Detection stays stock. Benchmark before/after on the same crops and labels, if you did not fine-tune the exact tier you serve, do not expect the gain.
