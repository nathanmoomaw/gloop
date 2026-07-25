// AudioWorklet processor for grain-pool capture — runs on the dedicated
// audio render thread instead of the main thread, replacing the previous
// ScriptProcessorNode (deprecated, and main-thread contention with the
// WebGL grain-field render was a real glitch risk — see ROADMAP/DEVLOG).
//
// Render quantums are a fixed 128 samples; this accumulates them into
// 2048-sample blocks (matching the old ScriptProcessor's bufferSize) before
// posting to the main thread via a transferred buffer, so message-passing
// overhead stays comparable (~21 messages/sec at 44.1kHz) instead of firing
// on every 128-sample quantum.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.blockSize = 2048
    this.buffer = new Float32Array(this.blockSize)
    this.writeIndex = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.writeIndex++] = channel[i]
        if (this.writeIndex >= this.blockSize) {
          this.port.postMessage(this.buffer, [this.buffer.buffer])
          this.buffer = new Float32Array(this.blockSize)
          this.writeIndex = 0
        }
      }
    }
    return true
  }
}

registerProcessor('recorder-processor', RecorderProcessor)
