export const connectManagedAudioEdges = (
  input: AudioNode | null | undefined,
  node: AudioNode,
  destination: AudioNode | null,
): (() => void) => {
  input?.connect(node)
  if (destination)
    node.connect(destination)

  return () => {
    if (input) {
      try {
        input.disconnect(node)
      }
      catch {}
    }
    if (destination) {
      try {
        node.disconnect(destination)
      }
      catch {}
    }
  }
}
