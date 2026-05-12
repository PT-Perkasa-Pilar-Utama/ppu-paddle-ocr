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

## Disclosure Policy

We follow responsible disclosure. Once a fix is released we will publish a GitHub Security Advisory describing the issue, affected versions, and the fix.
