// Toca o som dos alertas.
//
// Existe porque service worker não reproduz áudio — o Chrome exige um
// documento offscreen para isso.
//
// Os tons são sintetizados com Web Audio em vez de arquivos: não há assets
// para empacotar, soa idêntico em macOS, Windows e Linux, e evita distribuir
// os sons do sistema da Apple. Cada tipo tem um desenho melódico próprio, para
// você identificar a urgência sem olhar para a tela.

const TONS = {
  // [frequência Hz, início s, duração s] — DM sobe (chama atenção)
  dm:     [[587.33, 0.00, 0.13], [880.00, 0.11, 0.22]],
  // menção: duas notas agudas e curtas, mais incisivas
  mencao: [[1046.50, 0.00, 0.09], [1318.51, 0.10, 0.18]],
  // canal: uma nota só, grave e discreta — é informativo, não pessoal
  canal:  [[523.25, 0.00, 0.16]],
};

function tocar(tipo, volume = 0.8) {
  const ctx = new AudioContext();
  const notas = TONS[tipo] ?? TONS.dm;
  const ganhoMestre = ctx.createGain();
  ganhoMestre.gain.value = Math.max(0, Math.min(1, volume));
  ganhoMestre.connect(ctx.destination);

  let fim = 0;
  for (const [hz, inicio, duracao] of notas) {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;

    // Envelope suave: sem ataque/decaimento o tom estala no alto-falante.
    const t = ctx.currentTime + inicio;
    ganho.gain.setValueAtTime(0, t);
    ganho.gain.linearRampToValueAtTime(1, t + 0.012);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t + duracao);

    osc.connect(ganho);
    ganho.connect(ganhoMestre);
    osc.start(t);
    osc.stop(t + duracao + 0.02);
    fim = Math.max(fim, inicio + duracao);
  }

  // Libera o contexto de áudio; sem isto eles se acumulam e o Chrome corta.
  setTimeout(() => ctx.close().catch(() => {}), (fim + 0.4) * 1000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.alvo !== "offscreen") return;
  if (msg.acao === "tocar") tocar(msg.tipo, msg.volume);
});
