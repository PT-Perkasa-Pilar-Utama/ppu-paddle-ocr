import type { InferenceSession, Tensor } from "onnxruntime-common";
import type {
  Canvas,
  CanvasToolkit,
  Contours,
  ImageProcessor,
  cv,
} from "ppu-ocv";
import type { CanvasLike } from "ppu-ocv/web";

// Unified Canvas type to support both Node and Web Canvas variations without forcing `any`
export type CoreCanvas = Canvas | CanvasLike;

/**
 * A generic abstraction mapping specifically to pure runtime-level APIs
 * (like ort/onnxruntime, canvas APIs, fetching mechanisms, etc).
 *
 * This injects the platform-specific dependencies into the shared Core logic.
 */
export interface PlatformProvider<TCanvas = CoreCanvas> {
  /** The specific pathing delimiter used on this platform (ie '/' vs '\') */
  pathSeparator: string;

  /** Platform-specific ONNX Runtime namespace (`onnxruntime-node` vs `onnxruntime-web`) */
  ort: {
    Tensor: typeof Tensor;
    InferenceSession: typeof InferenceSession;
  };

  /** Platform-specific canvas constructor (`createCanvas` vs `getPlatform().createCanvas`) */
  createCanvas: (width: number, height: number) => TCanvas;

  /** Type guard determining if an object is a recognized Canvas API implementation */
  isCanvas: (image: unknown) => image is TCanvas;

  /** Resolves resources asynchronously via local FileSystem (`fs`) or HTTP (`fetch`) based on the environment */
  loadResource: (
    source: string | ArrayBuffer | undefined,
    defaultUrl: string,
  ) => Promise<ArrayBuffer>;

  /** Optionally dump a given Canvas representation directly onto the disk (No-Op on Web context) */
  saveDebugImage: (
    canvas: TCanvas,
    filename: string,
    path: string,
  ) => Promise<void>;

  /** A wrapper for platform-specific Open-CV canvas image manipulation implementations (`ppu-ocv` vs `ppu-ocv/web`) */
  imageProcessor: {
    /** Injects the source Image buffer into a universally parsable Canvas */
    prepareCanvas: (image: unknown) => Promise<TCanvas>;

    /** Wrapper class handling matrix transformations */
    ImageProcessor: new (canvas: TCanvas) => ImageProcessor;

    /** Wrapper class handling mathematical OpenCV Contours */
    Contours: new (
      mat: cv.Mat,
      options: { mode: number; method: number },
    ) => Contours;

    /** Raw OpenCV webassembly object reference */
    cv: typeof cv;

    /** Static canvas utilities like cropping and drawing */
    CanvasToolkit: {
      getInstance(): CanvasToolkit;
    };
  };
}
