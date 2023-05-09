// WebcamWithZoom.js
import React, { useRef, useState } from 'react'
import Webcam from 'react-webcam'
import PropTypes from 'prop-types'

const WebcamWithZoom = (props) => {
  const webcamRef = useRef(null)
  const [zoom, setZoom] = useState(1)

  const increaseZoom = () => setZoom((prevZoom) => Math.min(prevZoom * 1.1, 5))
  const decreaseZoom = () => setZoom((prevZoom) => Math.max(prevZoom / 1.1, 1))

  const capture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    const offsetX = (256 * (zoom - 1)) / 2
    const offsetY = (256 * (zoom - 1)) / 2
    ctx.drawImage(
      webcamRef.current.video,
      offsetX,
      offsetY,
      256,
      256,
      0,
      0,
      256,
      256
    )
    const dataUrl = canvas.toDataURL()
    props.onCapture(dataUrl)
  }

  const videoConstraints = {
    width: 256 * zoom,
    height: 256 * zoom,
    facingMode: 'environment'
  }

  return (
    <div>
      <button onClick={increaseZoom}>Zoom In</button>
      <button onClick={decreaseZoom}>Zoom Out</button>
      <button onClick={capture}>Capture</button>
      <div style={{ overflow: 'hidden', width: 256, height: 256, position: 'relative' }}>
        <Webcam
          ref={webcamRef}
          videoConstraints={videoConstraints}
          style={{
            position: 'absolute',
            top: `-${(256 * (zoom - 1)) / 2}px`,
            left: `-${(256 * (zoom - 1)) / 2}px`
          }}
        />
        {props.children}
      </div>
    </div>
  )
}

WebcamWithZoom.propTypes = {
  onCapture: PropTypes.func.isRequired,
  children: PropTypes.node
}

export default WebcamWithZoom
