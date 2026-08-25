class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Threshold para considerar silêncio (ajustável dinamicamente via port.onmessage).
    // Sons com amplitude abaixo disso serão cortados.
    this.threshold = 0.02;
    // Attack e release para suavizar a entrada/saída do áudio e evitar estalos
    this.attack = 0.05; 
    this.release = 0.005;
    this.currentGain = 0.0;

    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.threshold === 'number') {
        this.threshold = Math.max(0.0005, Math.min(0.25, e.data.threshold));
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length || !input[0].length) return true;

    // Calcula o volume máximo deste bloco
    let maxAbs = 0;
    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      const val = Math.abs(channelData[i]);
      if (val > maxAbs) maxAbs = val;
    }

    // Se passou do threshold, ganho alvo é 1 (aberto). Se não, 0 (fechado).
    const targetGain = maxAbs > this.threshold ? 1.0 : 0.0;
    const delta = targetGain > this.currentGain ? this.attack : this.release;

    // Aplica o ganho com suavização em todos os canais
    for (let c = 0; c < input.length; c++) {
      const inData = input[c];
      const outData = output[c];
      let gain = this.currentGain;
      
      for (let i = 0; i < inData.length; i++) {
        gain += (targetGain - gain) * delta;
        outData[i] = inData[i] * gain;
      }
      
      // Salva o estado do ganho para o próximo bloco (baseado no último canal processado)
      if (c === input.length - 1) {
        this.currentGain = gain;
      }
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
