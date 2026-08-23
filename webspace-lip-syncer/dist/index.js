// src/pcm-lip-syncer.js
var DEFAULT_MODEL_URL = new URL("../model/model.onnx", import.meta.url);
var DEFAULT_WORKER_URL = new URL("./lip-sync.worker.js", import.meta.url);
function detailEvent(type, detail) {
  if (typeof CustomEvent === "function") return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}
var PcmLipSyncer = class _PcmLipSyncer extends EventTarget {
  static async create(options) {
    const instance = new _PcmLipSyncer();
    await instance.initialize(options);
    return instance;
  }
  constructor() {
    super();
    this.worker = null;
    this.destroyed = false;
    this.currentViseme = 0;
  }
  async initialize({
    inputSampleRate,
    modelUrl = DEFAULT_MODEL_URL,
    workerUrl = DEFAULT_WORKER_URL,
    wasmBaseUrl,
    workerFactory,
    readyTimeoutMs = 3e4,
    silenceThresholdDb = -50,
    silenceHoldMs = 120,
    agreementFrames = 3,
    minimumVisemeFrames = 2
  } = {}) {
    if (!(inputSampleRate > 0)) throw new RangeError("inputSampleRate is required and must be positive");
    this.worker = workerFactory ? workerFactory(workerUrl) : new Worker(workerUrl, { type: "module", name: "webspace-lip-sync-inference" });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Lip sync worker initialization timed out")),
          readyTimeoutMs
        );
        this.worker.onmessage = (event) => {
          const message = event.data;
          if (message?.type === "ready") {
            clearTimeout(timeout);
            resolve();
          } else if (message?.type === "error") {
            const error = new Error(message.error?.message || "Lip sync worker failed");
            error.stack = message.error?.stack || error.stack;
            clearTimeout(timeout);
            reject(error);
          } else {
            this.handleWorkerMessage(message);
          }
        };
        this.worker.onerror = (event) => {
          clearTimeout(timeout);
          reject(event.error || new Error(event.message || "Lip sync worker failed"));
        };
        this.worker.postMessage({
          type: "init",
          inputSampleRate,
          modelUrl: String(modelUrl),
          wasmBaseUrl: wasmBaseUrl ? String(wasmBaseUrl) : void 0,
          options: { silenceThresholdDb, silenceHoldMs, agreementFrames, minimumVisemeFrames }
        });
      });
    } catch (error) {
      this.worker?.terminate();
      this.worker = null;
      throw error;
    }
    this.worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    this.worker.onerror = (event) => {
      const error = event.error || new Error(event.message || "Lip sync worker failed");
      this.dispatchEvent(detailEvent("error", error));
    };
  }
  handleWorkerMessage(message) {
    if (message?.type === "viseme") {
      this.currentViseme = message.detail.viseme;
      this.dispatchEvent(detailEvent("viseme", message.detail));
    } else if (message?.type === "error") {
      const error = new Error(message.error?.message || "Lip sync worker failed");
      error.stack = message.error?.stack || error.stack;
      this.dispatchEvent(detailEvent("error", error));
    }
  }
  push(samples, timestamp = 0) {
    this.assertActive();
    if (!(samples instanceof Float32Array)) throw new TypeError("samples must be a Float32Array");
    const copy = samples.slice();
    this.worker.postMessage({ type: "audio", samples: copy.buffer, timestamp }, [copy.buffer]);
  }
  attachAudioPort(port) {
    this.assertActive();
    this.worker.postMessage({ type: "attach-audio-port", port }, [port]);
  }
  setSpeaking(speaking) {
    this.assertActive();
    this.worker.postMessage({ type: "set-speaking", speaking });
  }
  reset() {
    this.assertActive();
    this.currentViseme = 0;
    this.worker.postMessage({ type: "reset" });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.worker?.postMessage({ type: "destroy" });
    this.worker?.terminate();
    this.worker = null;
  }
  assertActive() {
    if (this.destroyed || !this.worker) throw new Error("Lip syncer has been destroyed");
  }
};

// src/core/analysis-conditioning.js
var ANALYSIS_CONDITIONING = Object.freeze({
  gain: 3,
  threshold: -12,
  knee: 0,
  ratio: 20,
  attack: 5e-3,
  release: 0.05
});
function createAnalysisConditioner(audioContext) {
  const gainNode = audioContext.createGain();
  const compressorNode = audioContext.createDynamicsCompressor();
  gainNode.gain.setValueAtTime(ANALYSIS_CONDITIONING.gain, audioContext.currentTime);
  compressorNode.threshold.value = ANALYSIS_CONDITIONING.threshold;
  compressorNode.knee.value = ANALYSIS_CONDITIONING.knee;
  compressorNode.ratio.value = ANALYSIS_CONDITIONING.ratio;
  compressorNode.attack.value = ANALYSIS_CONDITIONING.attack;
  compressorNode.release.value = ANALYSIS_CONDITIONING.release;
  gainNode.connect(compressorNode);
  return { input: gainNode, output: compressorNode, gainNode, compressorNode };
}

// src/web-audio-lip-syncer.js
var DEFAULT_WORKLET_URL = new URL("./pcm-capture.worklet.js", import.meta.url);
function detailEvent2(type, detail) {
  if (typeof CustomEvent === "function") return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}
var WebAudioLipSyncer = class _WebAudioLipSyncer extends EventTarget {
  static async create(audioContext, options = {}) {
    if (!audioContext?.audioWorklet) throw new TypeError("An AudioContext with AudioWorklet support is required");
    const pcm = await PcmLipSyncer.create({ ...options, inputSampleRate: audioContext.sampleRate });
    try {
      await audioContext.audioWorklet.addModule(options.workletUrl || DEFAULT_WORKLET_URL);
      return new _WebAudioLipSyncer(audioContext, pcm, options);
    } catch (error) {
      pcm.destroy();
      throw error;
    }
  }
  constructor(audioContext, pcm, { chunkSize = 512, conditionAudio = true, sourceNode } = {}) {
    super();
    this.audioContext = audioContext;
    this.pcm = pcm;
    this.sourceNode = null;
    this.destroyed = false;
    this.pcmTapPort = null;
    this.captureNode = new AudioWorkletNode(audioContext, "webspace-lip-sync-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { chunkSize }
    });
    this.silentGain = audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.captureNode.connect(this.silentGain);
    this.silentGain.connect(audioContext.destination);
    this.conditioner = conditionAudio ? createAnalysisConditioner(audioContext) : null;
    this.analysisInputNode = this.conditioner?.input || this.captureNode;
    if (this.conditioner) this.conditioner.output.connect(this.captureNode);
    const channel = new MessageChannel();
    this.captureNode.port.postMessage({ type: "attach-output-port", port: channel.port1 }, [channel.port1]);
    this.pcm.attachAudioPort(channel.port2);
    this.forwardViseme = (event) => this.dispatchEvent(detailEvent2("viseme", event.detail));
    this.forwardError = (event) => this.dispatchEvent(detailEvent2("error", event.detail));
    this.pcm.addEventListener("viseme", this.forwardViseme);
    this.pcm.addEventListener("error", this.forwardError);
    if (sourceNode) this.connect(sourceNode);
  }
  get currentViseme() {
    return this.pcm.currentViseme;
  }
  connect(sourceNode) {
    this.assertActive();
    if (!sourceNode?.connect) throw new TypeError("sourceNode must be an AudioNode");
    this.disconnect();
    this.sourceNode = sourceNode;
    this.sourceNode.connect(this.analysisInputNode);
    return this;
  }
  disconnect() {
    if (!this.sourceNode) return;
    this.sourceNode.disconnect(this.analysisInputNode);
    this.sourceNode = null;
  }
  createPcmTap() {
    this.assertActive();
    if (this.pcmTapPort) throw new Error("A PCM tap is already attached");
    const channel = new MessageChannel();
    this.captureNode.port.postMessage({ type: "attach-tap-port", port: channel.port1 }, [channel.port1]);
    this.pcmTapPort = channel.port2;
    return channel.port2;
  }
  detachPcmTap() {
    if (!this.pcmTapPort) return;
    this.captureNode.port.postMessage({ type: "detach-tap-port" });
    this.pcmTapPort = null;
  }
  setSpeaking(speaking) {
    this.pcm.setSpeaking(speaking);
  }
  reset() {
    this.pcm.reset();
  }
  destroy() {
    if (this.destroyed) return;
    this.disconnect();
    this.destroyed = true;
    this.detachPcmTap();
    this.captureNode.port.postMessage({ type: "stop" });
    this.captureNode.disconnect();
    this.conditioner?.gainNode.disconnect();
    this.conditioner?.compressorNode.disconnect();
    this.silentGain.disconnect();
    this.pcm.removeEventListener("viseme", this.forwardViseme);
    this.pcm.removeEventListener("error", this.forwardError);
    this.pcm.destroy();
  }
  assertActive() {
    if (this.destroyed) throw new Error("Lip syncer has been destroyed");
  }
};

// src/core/constants.js
var MODEL_SAMPLE_RATE = 16e3;
var MODEL_WINDOW_SIZE = 400;
var MODEL_HOP_SIZE = 160;
var MODEL_FEATURE_COUNT = 40;
var MODEL_VISEME_COUNT = 12;
var MODEL_INFERENCE_STRIDE = 2;
var MODEL_HIDDEN_SIZE = 256;
var MODEL_HIDDEN_LAYERS = 2;
var MODEL_LABEL_DELAY_FRAMES = 10;
var MODEL_LABEL_DELAY_SECONDS = MODEL_LABEL_DELAY_FRAMES * MODEL_HOP_SIZE / MODEL_SAMPLE_RATE;
var MODEL_TARGET_LOOKAHEAD_SECONDS = MODEL_LABEL_DELAY_SECONDS;
var FEATURE_MEANS = new Float32Array([
  -5.178135395050049,
  -3.862858772277832,
  -3.1101880073547363,
  -2.755587100982666,
  -3.0430493354797363,
  -3.2332587242126465,
  -3.4269723892211914,
  -3.580195188522339,
  -3.969560146331787,
  -4.4346184730529785,
  -4.8664116859436035,
  -5.223193645477295,
  -5.542689800262451,
  -5.686837196350098,
  -5.902678489685059,
  -6.022074222564697,
  -6.072000026702881,
  -6.047482967376709,
  -5.978076934814453,
  -6.03010892868042,
  -6.151273250579834,
  -6.284173011779785,
  -6.369907379150391,
  -6.314164638519287,
  -6.358320236206055,
  -6.506461143493652,
  -6.690983772277832,
  -6.732577323913574,
  -6.759754657745361,
  -6.870426177978516,
  -7.041579723358154,
  -7.234762668609619,
  -7.41867208480835,
  -7.605552673339844,
  -7.776374816894531,
  -7.842645645141602,
  -7.888894557952881,
  -8.07901668548584,
  -8.50893783569336,
  -9.225114822387695
]);
var FEATURE_STANDARD_DEVIATIONS = new Float32Array([
  4.365628719329834,
  5.085516929626465,
  5.308014869689941,
  5.434023380279541,
  5.431894302368164,
  5.414535045623779,
  5.462785720825195,
  5.481420516967773,
  5.3639349937438965,
  5.175177574157715,
  4.961434364318848,
  4.743328094482422,
  4.578188896179199,
  4.483177185058594,
  4.413117408752441,
  4.365939617156982,
  4.346749305725098,
  4.357524394989014,
  4.377785682678223,
  4.362161636352539,
  4.313436985015869,
  4.262465000152588,
  4.262777805328369,
  4.320459842681885,
  4.337669849395752,
  4.2552008628845215,
  4.1821064949035645,
  4.193183898925781,
  4.214105606079102,
  4.1952009201049805,
  4.131778717041016,
  4.102622032165527,
  4.065732479095459,
  4.0249552726745605,
  4.0208740234375,
  3.984018087387085,
  3.973817825317383,
  3.9350409507751465,
  3.8640339374542236,
  3.822434902191162
]);
export {
  MODEL_FEATURE_COUNT,
  MODEL_HIDDEN_LAYERS,
  MODEL_HIDDEN_SIZE,
  MODEL_HOP_SIZE,
  MODEL_INFERENCE_STRIDE,
  MODEL_LABEL_DELAY_FRAMES,
  MODEL_LABEL_DELAY_SECONDS,
  MODEL_SAMPLE_RATE,
  MODEL_TARGET_LOOKAHEAD_SECONDS,
  MODEL_VISEME_COUNT,
  MODEL_WINDOW_SIZE,
  PcmLipSyncer,
  WebAudioLipSyncer
};
//# sourceMappingURL=index.js.map
