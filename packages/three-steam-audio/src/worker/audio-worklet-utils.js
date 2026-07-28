/* global renderQuantumSize */

const DEFAULT_RENDER_QUANTUM_SIZE = 128

export const getRenderQuantumSize = () => {
  const size = typeof renderQuantumSize === 'number'
    ? renderQuantumSize
    : DEFAULT_RENDER_QUANTUM_SIZE
  return Number.isInteger(size) && size > 0
    ? size
    : DEFAULT_RENDER_QUANTUM_SIZE
}

export const silenceOutput = (output) => {
  for (const channel of output)
    channel.fill(0)
}
