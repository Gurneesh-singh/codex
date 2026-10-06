// Browser recording cleanup. Keep the original whenever decoding or VAD is uncertain.
export async function prepareVoiceAudio(file: File): Promise<File> {
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') return file;
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!decoded.length || decoded.duration > 31) return file;
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i]! / decoded.numberOfChannels;
    }
    const frame = Math.max(1, Math.round(decoded.sampleRate * 0.02));
    const levels: number[] = [];
    for (let start = 0; start < mono.length; start += frame) {
      let power = 0;
      const end = Math.min(start + frame, mono.length);
      for (let i = start; i < end; i++) power += mono[i]! * mono[i]!;
      levels.push(Math.sqrt(power / (end - start)));
    }
    const sorted = [...levels].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
    // This conservative threshold avoids deleting soft speech in a noisy mandi.
    const threshold = Math.max(0.009, Math.min(0.035, floor * 2.2));
    // Require several consecutive active frames so clicks do not stretch the clip.
    let firstSpeech = -1;
    let lastSpeech = -1;
    let run = 0;
    for (let index = 0; index < levels.length; index++) {
      run = levels[index]! >= threshold ? run + 1 : 0;
      if (run >= 3) {
        if (firstSpeech < 0) firstSpeech = index - run + 1;
        lastSpeech = index;
      }
    }
    if (firstSpeech < 0 || lastSpeech - firstSpeech < 5) return file;
    const pad = Math.round(decoded.sampleRate * 0.3);
    const begin = Math.max(0, firstSpeech * frame - pad);
    const end = Math.min(mono.length, (lastSpeech + 1) * frame + pad);
    if (end - begin < decoded.sampleRate * 0.4) return file;
    // Compress peaks gently. Distortion already clipped at the microphone cannot be repaired here.
    const offline = new OfflineAudioContext(1, end - begin, decoded.sampleRate);
    const sourceBuffer = offline.createBuffer(1, end - begin, decoded.sampleRate);
    sourceBuffer.copyToChannel(mono.subarray(begin, end), 0);
    const source = offline.createBufferSource();
    source.buffer = sourceBuffer;
    const compressor = offline.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    source.connect(compressor).connect(offline.destination);
    source.start();
    const rendered = (await offline.startRendering()).getChannelData(0);
    let peak = 0;
    for (const value of rendered) peak = Math.max(peak, Math.abs(value));
    const gain = peak > 0.01 ? Math.min(2, 0.88 / peak) : 1;
    const wav = new ArrayBuffer(44 + rendered.length * 2);
    const view = new DataView(wav);
    const label = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    label(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); label(8, 'WAVE');
    label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, decoded.sampleRate, true);
    view.setUint32(28, decoded.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, 'data'); view.setUint32(40, rendered.length * 2, true);
    for (let i = 0; i < rendered.length; i++) {
      const value = Math.max(-1, Math.min(1, rendered[i]! * gain));
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    const prepared = new File([wav], 'voice-order-clean.wav', { type: 'audio/wav' });
    return prepared.size <= 10 * 1024 * 1024 ? prepared : file;
  } catch { return file; }
  finally { await context.close().catch(() => undefined); }
}
