export const silenceOutput = (output, startIndex = 0) => {
  for (const channel of output)
    channel.fill(0, startIndex)
}
