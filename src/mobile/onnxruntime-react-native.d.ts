// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

// onnxruntime-react-native's public typings re-export onnxruntime-common
// (already installed via onnxruntime-node/-web), so the mobile entry
// type-checks without installing the package itself. Installing it pulls
// react-native -> metro -> image-size, which carries unfixed High CVEs
// (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) and fails the SCA gate.
// Consumers are unaffected: they install the real package, and this
// declaration file is not emitted into lib/.
declare module "onnxruntime-react-native" {
  export * from "onnxruntime-common";
}
