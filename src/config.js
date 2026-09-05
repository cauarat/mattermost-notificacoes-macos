// Carrega config.json e preenche valores ausentes com padrões, para que um
// config incompleto (ou editado à mão sem cuidado) nunca derrube o daemon.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aviso } from "./log.js";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const PADRAO = {
  servidor: "https://team.actuar.group",
  canaisMonitorados: [],
  duracaoPopupSegundos: 12,
  notificacaoNativa: true,
  posicao: "superior-direito",
  som: {
    ativado: true,
    volume: 0.8,
    porTipo: { dm: "Hero", mencao: "Glass", canal: "Tink" },
    insistir: { ativado: false, intervaloSegundos: 4, maximo: 3 },
  },
};

export function carregarConfig() {
  let bruto = {};
  try {
    bruto = JSON.parse(readFileSync(join(RAIZ, "config.json"), "utf8"));
  } catch (e) {
    aviso(`config.json ilegível (${e.message}); usando padrões.`);
  }

  const cfg = {
    ...PADRAO,
    ...bruto,
    som: {
      ...PADRAO.som,
      ...(bruto.som ?? {}),
      porTipo: { ...PADRAO.som.porTipo, ...(bruto.som?.porTipo ?? {}) },
      insistir: { ...PADRAO.som.insistir, ...(bruto.som?.insistir ?? {}) },
    },
  };

  // Normaliza a URL para não duplicar barras ao montar endpoints.
  cfg.servidor = cfg.servidor.replace(/\/+$/, "");
  if (!Array.isArray(cfg.canaisMonitorados)) cfg.canaisMonitorados = [];
  return cfg;
}
