// Find the largest connected region in the mask, starting from the center.
// Thanks GPT-4.
export function updateMask (mask, width, height) {
  const visited = new Array(width * height).fill(false)

  function isValid (x, y) {
    return x >= 0 && x < width && y >= 0 && y < height
  }

  function bfs (x, y) {
    const queue = [{ x, y }]
    const region = []

    while (queue.length > 0) {
      const { x, y } = queue.shift()
      const index = y * width + x

      if (!isValid(x, y) || visited[index] || mask[index] <= 0.5) continue

      visited[index] = true
      region.push(index)

      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0]
      ]) {
        queue.push({ x: x + dx, y: y + dy })
      }
    }

    return region
  }

  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2)
  const centerIndex = centerY * width + centerX

  if (mask[centerIndex] <= 0.5) {
    console.error('Center pixel is not in the mask.')
    return
  }

  const largestRegion = bfs(centerX, centerY)

  // Update mask in place
  for (let i = 0; i < mask.length; i++) {
    mask[i] = largestRegion.includes(i) ? mask[i] : 0
  }
}
