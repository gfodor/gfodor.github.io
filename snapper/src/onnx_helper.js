import ort from 'onnxruntime-web'

export async function imageToTensor (imageUrl) {
  return new Promise((resolve) => {
    const image = new Image()
    image.src = imageUrl
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, image.width, image.height)

      const imageData = ctx.getImageData(0, 0, image.width, image.height)
      const { data, width, height } = imageData

      // Normalize the pixel values to the range [0, 1] and re-arrange the dimensions to
      // be [C, H, W] as per torchvision format, which RITM was trained on. Input data is arranged by width then height so needs to be reverse read.
      const inputTensor = new Float32Array(4 * width * height)

      const getPixelAt = (x, y, c) => {
        return data[(y * width + x) * 4 + c] / 255
      }

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          inputTensor[0 * width * height + y * width + x] = getPixelAt(x, y, 0)
          inputTensor[1 * width * height + y * width + x] = getPixelAt(x, y, 1)
          inputTensor[2 * width * height + y * width + x] = getPixelAt(x, y, 2)
          inputTensor[3 * width * height + y * width + x] = 0
        }
      }

      resolve(new ort.Tensor('float32', inputTensor, [1, 4, height, width]))
    }
  })
}

export async function loadModel (modelPath) {
  const session = await ort.InferenceSession.create(modelPath)
  return session
}

// Load JSON tensors
export async function loadJSON (url) {
  const response = await fetch(url)
  const data = await response.json()
  return data
}

export function jsonToTensor (json, type) {
  const shape = [json.length, ...json[0].length ? [json[0].length] : [], ...json[0][0].length ? [json[0][0].length] : [], ...json[0][0][0].length ? [json[0][0][0].length] : []]
  const flattened = json.flat(Infinity)
  return new ort.Tensor(type, flattened, shape)
}
