// Log simples com timestamp: vai para stdout/stderr, que o launchd redireciona
// para logs/mm-notify.log e logs/mm-notify.err.
const carimbo = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export const log = (...args) => console.log(`[${carimbo()}]`, ...args);
export const aviso = (...args) => console.log(`[${carimbo()}] AVISO:`, ...args);
export const erro = (...args) => console.error(`[${carimbo()}] ERRO:`, ...args);
