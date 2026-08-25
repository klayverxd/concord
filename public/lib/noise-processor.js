class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Threshold para considerar silêncio (ajustável dinamicamente via port.onmessage).
    this.threshold = 0.02;
    // Histerese: só fecha quando cair bem abaixo do threshold de abertura,
    // senão o gate "chacoalha" (abre/fecha várias vezes por segundo) quando
    // o volume da voz oscila perto do limiar.
    this.closeRatio = 0.6;
    // Segura o gate aberto por um tempo depois que o volume caiu, para não
    // cortar pausas curtas entre sílabas/palavras no meio de uma frase.
    this.holdTime = 0.08;
    this.holdSamples = Math.round(this.holdTime * sampleRate);
    this.holdCounter = 0;
    this.isOpen = false;

    // Coeficientes do filtro de suavização (1 polo) a partir de um tempo em
    // segundos, independente da sample rate do dispositivo.
    this.attackCoef = timeToCoef(0.003);   // abre rápido: não corta o início da fala
    this.releaseCoef = timeToCoef(0.12);   // fecha devagar: não corta consoantes finais
    this.envAttackCoef = timeToCoef(0.005);
    this.envReleaseCoef = timeToCoef(0.05);

    this.envelope = 0;
    this.currentGain = 0;

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

    const channelData = input[0];
    const n = channelData.length;

    // Segue o envelope amostra a amostra: os coeficientes acima foram
    // calibrados para um passo por amostra, então atualizar só uma vez por
    // bloco (128 amostras) deixaria a resposta ~128x mais lenta que o tempo
    // pedido.
    for (let i = 0; i < n; i++) {
      const absVal = Math.abs(channelData[i]);
      const envCoef = absVal > this.envelope ? this.envAttackCoef : this.envReleaseCoef;
      this.envelope += (absVal - this.envelope) * envCoef;
    }

    if (this.envelope > this.threshold) {
      this.isOpen = true;
      this.holdCounter = this.holdSamples;
    } else if (this.envelope < this.threshold * this.closeRatio) {
      if (this.holdCounter > 0) this.holdCounter -= n;
      else this.isOpen = false;
    }

    const targetGain = this.isOpen ? 1 : 0;
    const coef = targetGain > this.currentGain ? this.attackCoef : this.releaseCoef;

    for (let c = 0; c < input.length; c++) {
      const inData = input[c];
      const outData = output[c];
      let gain = this.currentGain;

      for (let i = 0; i < inData.length; i++) {
        gain += (targetGain - gain) * coef;
        outData[i] = inData[i] * gain;
      }

      if (c === input.length - 1) this.currentGain = gain;
    }

    return true;
  }
}

function timeToCoef(seconds) {
  return 1 - Math.exp(-1 / (seconds * sampleRate));
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
