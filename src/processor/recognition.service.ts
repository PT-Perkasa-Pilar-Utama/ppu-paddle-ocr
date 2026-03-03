import * as ort from "onnxruntime-node";
import { Canvas, CanvasToolkit, ImageProcessor } from "ppu-ocv";
import {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "../constants.js";
import type {
  Box,
  DebuggingOptions,
  RecognitionOptions,
} from "../interface.js";

export interface RecognitionResult {
  text: string;
  box: Box;
  confidence: number;
}

/**
 * Service for detecting and recognizing text in images
 */
export class RecognitionService {
  private readonly options: RecognitionOptions;
  private readonly debugging: DebuggingOptions;
  private readonly session: ort.InferenceSession;
  private readonly toolkit: CanvasToolkit;

  private static readonly BLANK_INDEX = 0;
  private static readonly UNK_TOKEN = "<unk>";
  private static readonly MIN_CROP_WIDTH = 8;

  constructor(
    session: ort.InferenceSession,
    options: Partial<RecognitionOptions> = {},
    debugging: Partial<DebuggingOptions> = {}
  ) {
    this.session = session;
    this.toolkit = CanvasToolkit.getInstance();

    this.options = {
      ...DEFAULT_RECOGNITION_OPTIONS,
      ...options,
    };

    this.debugging = {
      ...DEFAULT_DEBUGGING_OPTIONS,
      ...debugging,
    };
  }

  /**
   * Logs a message if verbose debugging is enabled
   */
  private log(message: string): void {
    if (this.debugging.verbose) {
      console.log(`[RecognitionService] ${message}`);
    }
  }

  /**
   * Main method to run text recognition on an image with detected regions
   * @param image The original image buffer or image in Canvas
   * @param detection Array of bounding boxes from text detection
   * @param charactersDictionary Optional custom character dictionary
   * @returns Array of recognition results with text and bounding box, sorted in reading order
   */
  async run(
    image: ArrayBuffer | Canvas,
    detection: Box[],
    charactersDictionary?: string[]
  ): Promise<RecognitionResult[]> {
    this.log("Starting text recognition process");

    try {
      const sourceCanvasForCrop =
        image instanceof Canvas
          ? image
          : await ImageProcessor.prepareCanvas(image);

      const validBoxes = this.filterValidBoxes(detection);
      const results = await this.processBoxesInParallel(
        sourceCanvasForCrop,
        validBoxes,
        charactersDictionary
      );

      return this.sortResultsByReadingOrder(results);
    } catch (error) {
      console.error(
        "Error during text recognition:",
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Filter out invalid boxes
   */
  private filterValidBoxes(boxes: Box[]): Array<{ box: Box; index: number }> {
    return boxes
      .map((box, index) => ({ box, index }))
      .filter(({ box, index }) => this.isValidBox(box, index));
  }

  /**
   * Process all valid boxes in parallel using Promise.all
   */
  private async processBoxesInParallel(
    sourceCanvas: Canvas,
    boxData: Array<{ box: Box; index: number }>,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult[]> {
    const cropsDebugPath = this.debugging.debugFolder + "/crops";
    if (this.debugging.debug) {
      this.toolkit.clearOutput(cropsDebugPath);
    }

    const results: RecognitionResult[] = [];
    for (const { box, index } of boxData) {
      const result = await this.processBox(
        sourceCanvas,
        box,
        index,
        boxData.length,
        cropsDebugPath,
        charactersDictionary
      );
      if (result !== null) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Process a single text box
   */
  private async processBox(
    sourceCanvas: Canvas,
    box: Box,
    index: number,
    totalBoxes: number,
    debugPath: string,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult | null> {
    const start = Date.now();

    try {
      const cropCanvas = this.cropRegion(sourceCanvas, box);
      const { text: recognizedText, confidence } = await this.recognizeText(
        cropCanvas,
        charactersDictionary
      );

      if (this.debugging.debug) {
        await this.saveDebugCrop(cropCanvas, index, debugPath);
        this.logProcessingDetails(
          box,
          index,
          totalBoxes,
          recognizedText,
          start
        );
      }

      return { text: recognizedText, box, confidence };
    } catch (e: any) {
      console.error(`Error processing box ${index + 1}: ${e.message}`, e.stack);
      return null;
    }
  }

  /**
   * Sort recognition results by reading order (top to bottom, left to right)
   */
  private sortResultsByReadingOrder(
    results: RecognitionResult[]
  ): RecognitionResult[] {
    return [...results].sort((a, b) => {
      const boxA = a.box;
      const boxB = b.box;

      // If boxes are roughly on the same line (within 1/4 of their combined heights)
      if (Math.abs(boxA.y - boxB.y) < (boxA.height + boxB.height) / 4) {
        return boxA.x - boxB.x; // Sort left to right
      }
      return boxA.y - boxB.y; // Otherwise sort top to bottom
    });
  }

  /**
   * Validates if a bounding box has valid dimensions
   */
  private isValidBox(box: Box, index: number): boolean {
    if (box.width <= 0 || box.height <= 0) {
      console.warn(
        `Skipping invalid box ${index + 1}: w=${box.width}, h=${box.height}`
      );
      return false;
    }
    return true;
  }

  /**
   * Crops a region from the source canvas based on bounding box
   */
  private cropRegion(sourceCanvas: Canvas, box: Box): Canvas {
    return this.toolkit.crop({
      bbox: {
        x0: box.x,
        y0: box.y,
        x1: box.x + box.width,
        y1: box.y + box.height,
      },
      canvas: sourceCanvas,
    });
  }

  /**
   * Saves a debug image of the cropped region
   */
  private async saveDebugCrop(
    cropCanvas: Canvas,
    index: number,
    outputPath: string
  ): Promise<void> {
    await this.toolkit.saveImage({
      canvas: cropCanvas,
      filename: `crop_${String(index).padStart(3, "0")}.png`,
      path: outputPath,
    });
  }

  /**
   * Logs details about the processing of a text region
   */
  private logProcessingDetails(
    box: Box,
    index: number,
    totalBoxes: number,
    text: string,
    startTime: number
  ): void {
    const processingTime = Date.now() - startTime;
    this.log(
      `Box ${index + 1}/${totalBoxes}: [x:${box.x}, y:${box.y}, w:${
        box.width
      }, h:${box.height}]` +
        `\n\t → "${text}" (processed in ${processingTime}ms)\n`
    );
  }

  /**
   * Recognizes text in a cropped canvas region
   */
  private async recognizeText(
    cropCanvas: Canvas,
    charactersDictionary?: string[]
  ): Promise<{ text: string; confidence: number }> {
    const { imageTensor, tensorWidth, tensorHeight } =
      await this.preprocessImage(cropCanvas);

    let inputTensor: ort.Tensor | undefined;
    try {
      inputTensor = new ort.Tensor("float32", imageTensor, [
        1,
        3,
        tensorHeight,
        tensorWidth,
      ]);

      const results = await this.runInference(inputTensor);
      return this.decodeResults(results, charactersDictionary);
    } finally {
      inputTensor?.dispose();
    }
  }

  /**
   * Preprocesses a cropped image for the recognition model
   */
  private async preprocessImage(cropCanvas: Canvas): Promise<{
    imageTensor: Float32Array;
    tensorWidth: number;
    tensorHeight: number;
  }> {
    const processor = new ImageProcessor(cropCanvas);
    try {
      const targetHeight = this.options.imageHeight!;

      const originalWidth = processor.width;
      const originalHeight = processor.height;

      if (originalHeight === 0 || originalWidth === 0) {
        throw new Error(
          `Crop dimensions are zero: ${originalWidth}x${originalHeight}`
        );
      }

      const aspectRatio = originalWidth / originalHeight;
      const resizedWidth = Math.max(
        RecognitionService.MIN_CROP_WIDTH,
        Math.round(targetHeight * aspectRatio)
      );

      processor.resize({
        width: resizedWidth,
        height: targetHeight,
      });

      const imageTensor = this.createImageTensor(
        processor,
        resizedWidth,
        targetHeight
      );

      return {
        imageTensor,
        tensorWidth: resizedWidth,
        tensorHeight: targetHeight,
      };
    } finally {
      processor.destroy();
    }
  }

  /**
   * Creates a normalized image tensor from the preprocessed canvas
   */
  private createImageTensor(
    processor: ImageProcessor,
    width: number,
    height: number
  ): Float32Array {
    const canvas = processor.toCanvas();
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixelData = imageData.data; // RGBA format

    const numChannels = 3;
    const imageTensor = new Float32Array(numChannels * height * width);

    for (let h = 0; h < height; h++) {
      for (let w = 0; w < width; w++) {
        const pixelIndex = (h * width + w) * 4;
        const grayValue = pixelData[pixelIndex]!;
        const normalizedValue = (grayValue / 255.0 - 0.5) / 0.5;

        // Fill all three channels (R,G,B) with the same normalized value
        for (let c = 0; c < numChannels; c++) {
          const tensorIndex = c * height * width + h * width + w;
          imageTensor[tensorIndex] = normalizedValue;
        }
      }
    }

    return imageTensor;
  }

  /**
   * Runs the ONNX inference session with the prepared tensor
   */
  private async runInference(inputTensor: ort.Tensor): Promise<ort.Tensor> {
    const feeds = { x: inputTensor };
    const results = await this.session.run(feeds);

    const outputNodeName = Object.keys(results)[0];
    const outputTensor = results[outputNodeName];

    if (!outputTensor) {
      throw new Error(
        `Recognition output tensor '${outputNodeName}' not found. Available keys: ${Object.keys(
          results
        )}`
      );
    }

    return outputTensor;
  }

  /**
   * Decodes the results from the model output tensor
   */
  private decodeResults(
    outputTensor: ort.Tensor,
    charactersDictionary?: string[]
  ): {
    text: string;
    confidence: number;
  } {
    const outputData = outputTensor.data as Float32Array;
    const outputShape = outputTensor.dims;

    const sequenceLength = outputShape[1];
    const numClasses = outputShape[2];

    const dict = charactersDictionary || this.options.charactersDictionary;

    if (numClasses !== dict.length) {
      console.warn(
        `Warning: Model output classes (${numClasses}) does not match dictionary length (${dict.length})`
      );
    }

    return this.ctcGreedyDecode(outputData, sequenceLength, numClasses, dict);
  }

  /**
   * Performs greedy decoding on CTC model output logits
   */
  private ctcGreedyDecode(
    logits: Float32Array,
    sequenceLength: number,
    numClasses: number,
    charDict: string[]
  ): { text: string; confidence: number } {
    let decodedText = "";
    let lastCharIndex = -1;
    const charConfidences: number[] = [];

    for (let t = 0; t < sequenceLength; t++) {
      const { value: maxProb, index: predictedClassIndex } =
        this.findMaxProbabilityClass(logits, t, numClasses);

      if (
        predictedClassIndex === RecognitionService.BLANK_INDEX ||
        predictedClassIndex === lastCharIndex
      ) {
        lastCharIndex = predictedClassIndex;
        continue;
      }

      if (this.isValidDictionaryIndex(predictedClassIndex, charDict)) {
        this.appendCharacterToText(predictedClassIndex, charDict, (char) => {
          decodedText += char;
          charConfidences.push(maxProb);
        });
      } else {
        console.warn(
          `Decoded index ${predictedClassIndex} out of bounds for charDict (length ${charDict.length}) at t=${t}`
        );
      }

      lastCharIndex = predictedClassIndex;
    }

    const confidence =
      charConfidences.length > 0
        ? charConfidences.reduce((a, b) => a + b, 0) / charConfidences.length
        : 0;

    return { text: decodedText, confidence };
  }

  /**
   * Appends the appropriate character to the decoded text
   */
  private appendCharacterToText(
    index: number,
    charDict: string[],
    appendFn: (char: string) => void
  ): void {
    const char = charDict[index];

    if (index === charDict.length - 1) {
      if (char === RecognitionService.UNK_TOKEN) {
        // Skip unknown token
        return;
      } else {
        appendFn(" ");
        return;
      }
    }

    appendFn(char);
  }

  /**
   * Finds the class with maximum probability for a given timestep
   */
  private findMaxProbabilityClass(
    logits: Float32Array,
    timestep: number,
    numClasses: number
  ): { value: number; index: number } {
    let maxProb = -Infinity;
    let maxIndex = 0;

    for (let c = 0; c < numClasses; c++) {
      const prob = logits[timestep * numClasses + c];
      if (prob > maxProb) {
        maxProb = prob;
        maxIndex = c;
      }
    }

    return { value: maxProb, index: maxIndex };
  }

  /**
   * Checks if the predicted class index is valid for the character dictionary
   */
  private isValidDictionaryIndex(index: number, charDict: string[]): boolean {
    return index >= 0 && index < charDict.length;
  }
}
