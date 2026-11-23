import { uiAlerta } from "./ui-alerta.js";
import { montarHeaderPainel } from "./painel-header.js";
import { montarKpisPainel, atualizarKpisPainel } from "./painel-kpis.js";
import { criarModalDetalhesOS } from "./painel-modal-os.js";
import { criarLightboxPainel } from "./painel-lightbox.js";
import { criarGaleriaOffline } from "./painel-galeria-offline.js";
import { criarGerenciadorSync } from "./painel-sync.js";
import { criarGerenciadorBackup } from "./painel-backup.js";
import { criarGerenciadorCards } from "./painel-cards.js";

montarHeaderPainel("#headerSlot");
montarKpisPainel("#kpisSlot");

const state = {
  dados: [],
  blobUrls: [],
  sincronizandoBg: false,
  canalRealtime: null,
  realtimeAtivo: false,
};

const el = (id) => document.getElementById(id);

function setStatusIndicator(texto, isOffline) {
  el("statusTexto").textContent = texto;
  el("statusFonte").classList.toggle("offline", isOffline);
}

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function brl(n) {
  return Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

let galeriaOffline = null;
let gerenciadorCards = null;

const lightbox = criarLightboxPainel();

galeriaOffline = criarGaleriaOffline({
  onAbrirLightbox: (fotos, idx) => lightbox.abrir(fotos, idx),
  onAviso: (titulo, msg, tipo) => uiAlerta(titulo, msg, tipo),
});

const modalOS = criarModalDetalhesOS({
  onAbrirFoto: (fotosValidas, idx) => lightbox.abrir(fotosValidas, idx),
  onAtualizarOS: (os, patch) => gerenciadorCards?.atualizarOS(os, patch),
  onFechar: () => lightbox.fechar(),
});

gerenciadorCards = criarGerenciadorCards({
  state,
  modalOS,
  atualizarKpisPainel,
  esc,
  brl,
  getEl: el,
});

const gerenciadorSync = criarGerenciadorSync({
  state,
  setStatusIndicator,
  onDadosAtualizados: () => {
    gerenciadorBackup.atualizarInfoBackup();
    gerenciadorCards.render();
  },
  getBtnAtualizar: () => el("btnAtualizar"),
});

const gerenciadorBackup = criarGerenciadorBackup({
  setStatusIndicator,
  carregarDoBancoOffline: gerenciadorSync.carregarDoBancoOffline,
  sincronizarNovos: gerenciadorSync.sincronizarNovos,
  getEl: el,
});

/* ---------------- Eventos Globais ---------------- */

["fBusca", "fStatus", "fFinal", "fAparelho"].forEach((id) =>
  el(id).addEventListener("input", gerenciadorCards.render),
);

el("btnLimparFiltros").addEventListener("click", () => {
  el("fBusca").value = "";
  el("fStatus").value = "";
  el("fFinal").value = "";
  el("fAparelho").value = "";
  gerenciadorCards.render();
});

el("btnGaleriaOffline")?.addEventListener("click", () => {
  galeriaOffline.abrirGaleriaOffline(0);
});

el("btnAtualizar").addEventListener("click", () =>
  gerenciadorSync.sincronizarNovos(true),
);
el("btnInicialSupabase")?.addEventListener("click", () =>
  gerenciadorSync.sincronizarNovos(true),
);

el("btnRestaurarBackup")?.addEventListener(
  "click",
  gerenciadorBackup.solicitarRestauracaoComSenha,
);
el("btnInicialRestaurar")?.addEventListener(
  "click",
  gerenciadorBackup.solicitarRestauracaoComSenha,
);
el("inputRestaurarBackup")?.addEventListener("change", (e) => {
  gerenciadorBackup.acionarRestaurarBackup(e.target.files?.[0]);
});

el("btnExportarBackup")?.addEventListener(
  "click",
  gerenciadorBackup.acionarExportarBackup,
);

document.addEventListener("keydown", (e) => {
  if (lightbox.estaAberto()) {
    if (e.key === "Escape") lightbox.fechar();
    else if (e.key === "ArrowLeft") lightbox.navegar(-1);
    else if (e.key === "ArrowRight") lightbox.navegar(1);
    return;
  }

  if (e.key === "Escape" && galeriaOffline?.estaAberta?.()) {
    galeriaOffline.fechar();
    return;
  }

  if (e.key === "Escape" && modalOS.estaAberto()) {
    modalOS.fechar();
  }
});

window.addEventListener("online", async () => {
  await gerenciadorSync.sincronizarNovos(false);
  gerenciadorSync.iniciarRealtime();
});

window.addEventListener("offline", async () => {
  await gerenciadorSync.encerrarRealtime();
  await gerenciadorSync.carregarDoBancoOffline();
});

// 1. Exibe imediatamente o que já está no OsPainelDB
// 2. Baixa apenas OS que faltam e abre o Realtime
gerenciadorSync.carregarDoBancoOffline().then(async () => {
  await gerenciadorSync.sincronizarNovos(false);
  gerenciadorSync.iniciarRealtime();
});
