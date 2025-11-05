import {
  CompressedTexture,
  FileLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  Loader,
  RGBA_ASTC_4x4_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGB_ETC1_Format,
  RGB_PVRTC_4BPPV1_Format,
  UnsignedByteType
} from 'three';

const BASIS_FORMAT = {
  cTFETC1: 0,
  cTFETC2: 1,
  cTFBC1: 2,
  cTFBC3: 3,
  cTFBC4: 4,
  cTFBC5: 5,
  cTFBC7_M6_OPAQUE_ONLY: 6,
  cTFBC7_M5: 7,
  cTFPVRTC1_4_RGB: 8,
  cTFPVRTC1_4_RGBA: 9,
  cTFASTC_4x4: 10,
  cTFATC_RGB: 11,
  cTFATC_RGBA_INTERPOLATED_ALPHA: 12,
  cTFRGBA32: 13,
  cTFRGB565: 14,
  cTFBGR565: 15,
  cTFRGBA4444: 16
};

const DXT_FORMAT = {
  COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0,
  COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1,
  COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2,
  COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3
};

const DXT_FORMAT_MAP = {
  [BASIS_FORMAT.cTFBC1]: DXT_FORMAT.COMPRESSED_RGB_S3TC_DXT1_EXT,
  [BASIS_FORMAT.cTFBC3]: DXT_FORMAT.COMPRESSED_RGBA_S3TC_DXT5_EXT
};

const WORKER_CONSTANTS = `const BASIS_FORMAT = ${JSON.stringify(BASIS_FORMAT)};\n` +
  `const DXT_FORMAT_MAP = Object.fromEntries(Object.entries(${JSON.stringify(DXT_FORMAT_MAP)}).map(([k,v]) => [Number(k), v]));`;

class BasisTextureLoader extends Loader {
  constructor(manager) {
    super(manager);
    this.transcoderPath = '';
    this.transcoderBinary = null;
    this.transcoderPending = null;

    this.workerLimit = 4;
    this.workerPool = [];
    this.workerNextTaskID = 1;
    this.workerSourceURL = '';
    this.workerConfig = {
      format: null,
      astcSupported: false,
      etcSupported: false,
      dxtSupported: false,
      pvrtcSupported: false
    };
  }

  setTranscoderPath(path) {
    this.transcoderPath = path;
    return this;
  }

  setWorkerLimit(workerLimit) {
    this.workerLimit = workerLimit;
    return this;
  }

  detectSupport(renderer) {
    const config = this.workerConfig;

    config.astcSupported = !!renderer.extensions.get('WEBGL_compressed_texture_astc');
    config.etcSupported = !!renderer.extensions.get('WEBGL_compressed_texture_etc1');
    config.dxtSupported = !!renderer.extensions.get('WEBGL_compressed_texture_s3tc');
    config.pvrtcSupported =
      !!renderer.extensions.get('WEBGL_compressed_texture_pvrtc') ||
      !!renderer.extensions.get('WEBKIT_WEBGL_compressed_texture_pvrtc');

    if (config.astcSupported) {
      config.format = BASIS_FORMAT.cTFASTC_4x4;
    } else if (config.dxtSupported) {
      config.format = BASIS_FORMAT.cTFBC3;
    } else if (config.pvrtcSupported) {
      config.format = BASIS_FORMAT.cTFPVRTC1_4_RGBA;
    } else if (config.etcSupported) {
      config.format = BASIS_FORMAT.cTFETC1;
    } else {
      throw new Error('THREE.BasisTextureLoader: No suitable compressed texture format found.');
    }

    return this;
  }

  load(url, onLoad, onProgress, onError) {
    const loader = new FileLoader(this.manager);
    loader.setResponseType('arraybuffer');

    loader.load(
      url,
      buffer => {
        this._createTexture(buffer).then(onLoad).catch(onError);
      },
      onProgress,
      onError
    );
  }

  async _createTexture(buffer) {
    const taskCost = buffer.byteLength;
    const worker = await this._allocateWorker(taskCost);
    const taskID = this.workerNextTaskID++;

    try {
      const message = await new Promise((resolve, reject) => {
        worker._callbacks[taskID] = { resolve, reject };
        worker.postMessage({ type: 'transcode', id: taskID, buffer }, [buffer]);
      });

      const config = this.workerConfig;
      const { width, height, mipmaps, format } = message;

      let texture;
      switch (format) {
        case BASIS_FORMAT.cTFASTC_4x4:
          texture = new CompressedTexture(mipmaps, width, height, RGBA_ASTC_4x4_Format);
          break;
        case BASIS_FORMAT.cTFBC1:
        case BASIS_FORMAT.cTFBC3:
          texture = new CompressedTexture(
            mipmaps,
            width,
            height,
            DXT_FORMAT_MAP[config.format],
            UnsignedByteType
          );
          break;
        case BASIS_FORMAT.cTFETC1:
          texture = new CompressedTexture(mipmaps, width, height, RGB_ETC1_Format);
          break;
        case BASIS_FORMAT.cTFPVRTC1_4_RGB:
          texture = new CompressedTexture(mipmaps, width, height, RGB_PVRTC_4BPPV1_Format);
          break;
        case BASIS_FORMAT.cTFPVRTC1_4_RGBA:
          texture = new CompressedTexture(mipmaps, width, height, RGBA_PVRTC_4BPPV1_Format);
          break;
        default:
          throw new Error('THREE.BasisTextureLoader: No supported format available.');
      }

      texture.minFilter = mipmaps.length === 1 ? LinearFilter : LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;

      return texture;
    } finally {
      worker._taskLoad -= taskCost;
      delete worker._callbacks[taskID];
    }
  }

  _initTranscoder() {
    if (!this.transcoderPending) {
      const jsLoader = new FileLoader(this.manager);
      jsLoader.setPath(this.transcoderPath);
      const jsContent = new Promise((resolve, reject) => {
        jsLoader.load('basis_transcoder.js', resolve, undefined, reject);
      });

      const binaryLoader = new FileLoader(this.manager);
      binaryLoader.setPath(this.transcoderPath);
      binaryLoader.setResponseType('arraybuffer');
      const binaryContent = new Promise((resolve, reject) => {
        binaryLoader.load('basis_transcoder.wasm', resolve, undefined, reject);
      });

      this.transcoderPending = Promise.all([jsContent, binaryContent]).then(([js, binary]) => {
        const fn = BasisTextureLoaderWorkerFunction.toString();
        const workerScript = [
          '/* basis_transcoder.js */',
          js,
          '/* constants */',
          WORKER_CONSTANTS,
          '/* worker */',
          `(${fn})();`
        ].join('\n');

        this.workerSourceURL = URL.createObjectURL(new Blob([workerScript]));
        this.transcoderBinary = binary;
      });
    }

    return this.transcoderPending;
  }

  async _allocateWorker(taskCost) {
    await this._initTranscoder();

    if (this.workerPool.length < this.workerLimit) {
      const worker = new Worker(this.workerSourceURL);
      worker._callbacks = {};
      worker._taskLoad = 0;

      worker.postMessage({
        type: 'init',
        config: this.workerConfig,
        transcoderBinary: this.transcoderBinary
      });

      worker.onmessage = e => {
        const message = e.data;
        switch (message.type) {
          case 'transcode':
            worker._callbacks[message.id].resolve(message);
            break;
          case 'error':
            worker._callbacks[message.id].reject(message);
            break;
          default:
            console.error(`THREE.BasisTextureLoader: Unexpected message, "${message.type}"`);
        }
      };

      this.workerPool.push(worker);
    } else {
      this.workerPool.sort((a, b) => (a._taskLoad > b._taskLoad ? -1 : 1));
    }

    const worker = this.workerPool[this.workerPool.length - 1];
    worker._taskLoad += taskCost;
    return worker;
  }

  dispose() {
    for (const worker of this.workerPool) {
      worker.terminate();
    }
    this.workerPool.length = 0;
    return this;
  }
}

function BasisTextureLoaderWorkerFunction() {
  let config;
  let transcoderPending;
  let BasisFileClass;

  self.onmessage = function (e) {
    const message = e.data;

    switch (message.type) {
      case 'init':
        config = message.config;
        init(message.transcoderBinary);
        break;

      case 'transcode':
        transcoderPending.then(() => {
          try {
            const result = transcode(message.buffer);
            const buffers = result.mipmaps.map(level => level.data.buffer);
            self.postMessage({ type: 'transcode', id: message.id, ...result }, buffers);
          } catch (error) {
            console.error(error);
            self.postMessage({ type: 'error', id: message.id, error: error.message });
          }
        });
        break;

      default:
        break;
    }
  };

  function init(wasmBinary) {
    let BasisModule;
    transcoderPending = new Promise(resolve => {
      BasisModule = { wasmBinary, onRuntimeInitialized: resolve };
      BASIS(BasisModule);
    }).then(() => {
      const { BasisFile, initializeBasis } = BasisModule;
      BasisFileClass = BasisFile;
      initializeBasis();
    });
  }

  function transcode(buffer) {
    const basisFile = new BasisFileClass(new Uint8Array(buffer));

    const width = basisFile.getImageWidth(0, 0);
    const height = basisFile.getImageHeight(0, 0);
    const levels = basisFile.getNumLevels(0);
    const hasAlpha = basisFile.getHasAlpha();

    const cleanup = () => {
      basisFile.close();
      basisFile.delete();
    };

    if (!hasAlpha && config.format === BASIS_FORMAT.cTFPVRTC1_4_RGBA) {
      config.format = BASIS_FORMAT.cTFPVRTC1_4_RGB;
    }

    if (!width || !height || !levels) {
      cleanup();
      throw new Error('THREE.BasisTextureLoader:  Invalid .basis file');
    }

    if (!basisFile.startTranscoding()) {
      cleanup();
      throw new Error('THREE.BasisTextureLoader: .startTranscoding failed');
    }

    const mipmaps = [];

    for (let mip = 0; mip < levels; mip++) {
      const mipWidth = basisFile.getImageWidth(0, mip);
      const mipHeight = basisFile.getImageHeight(0, mip);
      const dst = new Uint8Array(basisFile.getImageTranscodedSizeInBytes(0, mip, config.format));

      const status = basisFile.transcodeImage(dst, 0, mip, config.format, 0, hasAlpha ? 1 : 0);

      if (!status) {
        cleanup();
        throw new Error('THREE.BasisTextureLoader: .transcodeImage failed.');
      }

      mipmaps.push({ data: dst, width: mipWidth, height: mipHeight });
    }

    cleanup();

    return { width, height, hasAlpha, mipmaps, format: config.format };
  }
}

export { BasisTextureLoader };
