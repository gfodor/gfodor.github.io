import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { loadModel, loadJSON, jsonToTensor, imageToTensor } from './onnx_helper'
import { updateMask } from './image_helpers'
import WebcamWithZoom from './WebcamWithZoom'

const modelPath = 'model-big.onnx' // Replace with the path to your ONNX model
let model = null

loadModel(modelPath).then((m) => {
  model = m
  setTimeout(() => document.querySelector('#loading').remove(), 500)
})

const App = () => {
  const [inferenceResult, setInferenceResult] = useState(null)

  useEffect(() => {
    async function performInference () {
    }

    if (inferenceResult === null) {
      setInferenceResult(performInference())
    }
  }, [inferenceResult])

  const onCapture = async (dataUrl) => {
    if (model === null) return

    const image = await imageToTensor(dataUrl)

    const coordsJSON = await loadJSON('coords.json')
    const coordsTensor = jsonToTensor(coordsJSON, 'int32')

    const outputs = await model.run({ image, coords: coordsTensor })
    const inferenceResult = outputs.instances.data

    for (let i = 0; i < inferenceResult.length; i++) {
      inferenceResult[i] = 1 / (1 + Math.exp(-inferenceResult[i]))
    }

    updateMask(inferenceResult, image.dims[3], image.dims[2])

    const canvas = document.getElementById('mask')
    canvas.width = image.dims[3]
    canvas.height = image.dims[2]
    const ctx = canvas.getContext('2d')

    for (let x = 0; x < canvas.width; x++) {
      for (let y = 0; y < canvas.height; y++) {
        const index = y * canvas.width + x
        const value = inferenceResult[index]
        if (value < 0.5) {
          ctx.fillStyle = 'black'
          ctx.fillRect(x, y, 1, 1)
        } else {
          // Use the color from the imageTensor
          const r = image.data[0 * canvas.width * canvas.height + index] * 255
          const g = image.data[1 * canvas.width * canvas.height + index] * 255
          const b = image.data[2 * canvas.width * canvas.height + index] * 255
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
          ctx.fillRect(x, y, 1, 1)
        }
      }
    }
  }

  // Create an absolutely positioned div that will draw a small reticle over
  // the center of the webcam feed. This is useful for centering the webcam
  //

  return (
    <div>
      <div id="loading" style={{ width: 1000, height: 1000 }}>Loading...</div>
      <canvas id="mask"></canvas>
    <WebcamWithZoom onCapture={onCapture}>
      <div id="reticle" style={{ position: 'absolute', top: '50%', left: '50%', width: 10, height: 10, borderRadius: 100, backgroundColor: 'rgba(0.5, 0.5, 0.5, 0.2)' }}></div>
    </WebcamWithZoom>
    </div>
  )
}

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<App />)
