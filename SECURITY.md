# Security Policy

## Supported Versions

Only the latest release on npm is actively maintained. Security fixes are not backported to older major versions.

| Version | Supported |
| :------ | :-------- |
| Latest  | Yes       |
| Older   | No        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email the maintainer at **awalariansyah7@gmail.com** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a minimal proof-of-concept
- The version(s) of ppu-paddle-ocr affected
- Any suggested remediation, if you have one

You will receive an acknowledgment within **72 hours**. We aim to assess and respond to valid reports within **7 days**, and to publish a fix and advisory within **30 days** of confirmation.

## Scope

This library performs local ONNX inference and reads image data. The attack surface is narrow but includes:

- **Model loading** — path traversal or SSRF if a caller passes untrusted strings to `model.detection` / `model.recognition` / `model.charactersDictionary`
- **Image input** — malformed image buffers passed to the ONNX runtime
- **Dependency vulnerabilities** — issues in `onnxruntime-node`, `onnxruntime-web`, or `ppu-ocv`

Out-of-scope reports:

- Vulnerabilities in `onnxruntime-node` or `onnxruntime-web` themselves — report those to [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime/security)
- Issues that require an attacker to already have write access to the host filesystem
- General questions or feature requests

## Dependency scanner notes

Static scanners (e.g. Socket) flag an **"obfuscated code"** alert on a few
transitive dependencies. These are false positives on minified or
machine-generated artifacts, not malicious code:

- `onnxruntime-web` — `dist/ort.webgpu.bundle.min.mjs` is a **minified** WASM /
  WebWorker bundle; `lib/onnxjs/ort-schema/protobuf/onnx.js` is **generated**
  protobuf binding code.
- `@protobufjs/float` (pulled in via `protobufjs`, a dependency of ONNX Runtime
  for parsing the protobuf-encoded model format) — hand-written IEEE-754
  bit-manipulation that trips dense-code heuristics.

The scanners' own deeper analysis rates all three low-risk with no evidence of
data exfiltration, backdoors, or supply-chain tampering. They originate from
the upstream ONNX Runtime (Microsoft) and protobuf.js packages, not from this
SDK. No action is required.

This package itself ships with **npm provenance** (a signed SLSA attestation
linking each release to the exact source commit and CI run) and runs **no
install scripts**.

## Disclosure Policy

We follow responsible disclosure. Once a fix is released we will publish a GitHub Security Advisory describing the issue, affected versions, and the fix.
