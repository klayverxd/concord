import createRNNWasmModule from './rnnoise.js';

// RNNoise exige exatamente 480 amostras (10ms a 48kHz) por chamada, mas o
// AudioWorklet entrega blocos de 128 — os anéis abaixo desacoplam os dois
// tamanhos sem precisar de array.push/shift (que geram lixo de GC na thread
// de áudio em tempo real).
const FRAME = 480;
// A API do RNNoise foi calibrada para PCM na escala de int16, não para o
// float -1..1 do Web Audio.
const SCALE = 32768;

class Ring {
  constructor(capacity) {
    this.data = new Float32Array(capacity);
    this.capacity = capacity;
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  push(arr, offset, count) {
    for (let i = 0; i < count; i++) {
      this.data[this.head] = arr[offset + i];
      this.head = (this.head + 1) % this.capacity;
      this.size++;
    }
  }

  shiftInto(dst, offset, count) {
    for (let i = 0; i < count; i++) {
      if (this.size > 0) {
        dst[offset + i] = this.data[this.tail];
        this.tail = (this.tail + 1) % this.capacity;
        this.size--;
      } else {
        dst[offset + i] = 0;
      }
    }
  }
}

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.mod = null;
    this.state = 0;
    this.inPtr = 0;
    this.outPtr = 0;
    this.frameBuf = new Float32Array(FRAME);

    const capacity = FRAME * 4;
    this.inRing = new Ring(capacity);
    this.outRing = new Ring(capacity);

    // fetch() não existe dentro do AudioWorkletGlobalScope neste engine, então
    // os bytes do .wasm vêm prontos de fora (thread principal) via
    // processorOptions — Module.wasmBinary do Emscripten pula o fetch interno.
    const wasmBinary = options?.processorOptions?.wasmBinary;
    createRNNWasmModule({ wasmBinary, locateFile: () => '/lib/rnnoise.wasm' }).then((mod) => {
      this.mod = mod;
      this.state = mod._rnnoise_create(0);
      this.inPtr = mod._malloc(FRAME * 4);
      this.outPtr = mod._malloc(FRAME * 4);
      this.ready = true;
    }).catch((e) => {
      console.error('RNNoise: falha ao carregar o modelo', e);
    });
  }

  denoiseFrame() {
    const { mod, state, inPtr, outPtr, frameBuf } = this;
    const heap = mod.HEAPF32;
    const inOff = inPtr / 4;
    const outOff = outPtr / 4;
    for (let i = 0; i < FRAME; i++) heap[inOff + i] = frameBuf[i] * SCALE;
    mod._rnnoise_process_frame(state, outPtr, inPtr);
    for (let i = 0; i < FRAME; i++) frameBuf[i] = heap[outOff + i] / SCALE;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !input[0].length) return true;

    const inData = input[0];
    const outData = output[0];
    const n = inData.length;

    // Enquanto o WASM ainda carrega (só acontece nos primeiros instantes),
    // deixa o áudio passar sem alteração em vez de cortar o som.
    if (!this.ready) {
      outData.set(inData);
      for (let c = 1; c < output.length; c++) output[c].set(inData);
      return true;
    }

    this.inRing.push(inData, 0, n);

    while (this.inRing.size >= FRAME) {
      this.inRing.shiftInto(this.frameBuf, 0, FRAME);
      this.denoiseFrame();
      this.outRing.push(this.frameBuf, 0, FRAME);
    }

    this.outRing.shiftInto(outData, 0, n);
    for (let c = 1; c < output.length; c++) output[c].set(outData);

    return true;
  }
}

registerProcessor('rnnoise-denoiser', RNNoiseProcessor);
