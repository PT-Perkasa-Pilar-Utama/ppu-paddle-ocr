# VEX statements

This directory holds [OpenVEX](https://github.com/openvex) documents for
vulnerabilities that scanners flag in ppu-paddle-ocr or its dependencies but
that do **not** affect users, because the vulnerable code path is never reached.

Each statement records a CVE, the affected product, a status
(`not_affected`, `affected`, `fixed`, or `under_investigation`), and a
justification. Downstream users and scanners can consume these to suppress
non-exploitable findings without ignoring real ones.

There are no outstanding statements as of the current release. When one is
needed, add a file named `CVE-YYYY-NNNNN.openvex.json` following the template
below.

## Template

```json
{
  "@context": "https://openvex.dev/ns/v0.2.0",
  "@id": "https://openvex.dev/docs/ppu-paddle-ocr/CVE-YYYY-NNNNN",
  "author": "PT Perkasa Pilar Utama",
  "timestamp": "YYYY-MM-DDThh:mm:ssZ",
  "version": 1,
  "statements": [
    {
      "vulnerability": { "name": "CVE-YYYY-NNNNN" },
      "products": [{ "@id": "pkg:npm/ppu-paddle-ocr@X.Y.Z" }],
      "status": "not_affected",
      "justification": "vulnerable_code_not_in_execute_path",
      "impact_statement": "Describe why the vulnerable function is never called from ppu-paddle-ocr."
    }
  ]
}
```
