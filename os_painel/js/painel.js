import { supabaseClient } from "../../js/supabase.js";
import { painelDb } from "./painel-db.js";
import { osCache } from "./os-cache.js";
import { uiAlerta } from "./ui-alerta.js";
import {
  exportarBackupComSenha,
  restaurarBackupArquivo,
  solicitarSenhaBackup,
  obterUltimoBackupTexto,
} from "./backup-manager.js";

const state = {
  dados: [],
  blobUrls: [],
  sincronizandoBg: false,
  canalRealtime: null,
  realtimeAtivo: false,
  lightboxFotos: [],
  lightboxIdx: 0,
};

const el = (id) => document.getElementById(id);

/* ---------------- Leitura do Banco Offline ---------------- */

async function carregarDoBancoOffline(statusExtra = "") {
  limparBlobUrls();
  const locais = await osCache.listarOffline();
  state.dados = locais.map(adaptarPainelDb);

  const isOffline = !navigator.onLine;
  const prefixo = isOffline
    ? "Offline"
    : state.realtimeAtivo
      ? "Realtime"
      : "Banco Local";
  const sufixo = statusExtra ? ` · ${statusExtra}` : "";
  setStatusIndicator(
    `${prefixo} · ${state.dados.length} OS${sufixo}`,
    isOffline,
  );
  atualizarInfoBackup();
  render();
}

/* ---------------- Sincronização Incremental ---------------- */

async function sincronizarNovos(forcarIndicador = false) {
  if (!navigator.onLine || state.sincronizandoBg) {
    if (forcarIndicador) {
      await carregarDoBancoOffline("sem internet");
    }
    return;
  }

  state.sincronizandoBg = true;
  if (forcarIndicador) {
    el("btnAtualizar").disabled = true;
    setStatusIndicator("Sincronizando…", false);
  }

  try {
    const res = await osCache.baixarNovosDoSupabase({
      limite: 500,
      baixarImagens: true,
    });

    if (res.ok && res.adicionados > 0) {
      await carregarDoBancoOffline(`+${res.adicionados} nova(s)`);
    } else if (forcarIndicador) {
      await carregarDoBancoOffline(res.ok ? "atualizado" : "falha na consulta");
    }
  } finally {
    state.sincronizandoBg = false;
    if (forcarIndicador) {
      el("btnAtualizar").disabled = false;
    }
  }
}

/* ---------------- Backup e Primeiro Acesso ---------------- */

function atualizarInfoBackup() {
  const infoEl = el("infoUltimoBackup");
  if (infoEl) {
    infoEl.textContent = obterUltimoBackupTexto();
  }
}

async function acionarExportarBackup() {
  const btn = el("btnExportarBackup");
  if (btn) btn.disabled = true;

  try {
    const res = await exportarBackupComSenha((msg) => {
      setStatusIndicator(msg, !navigator.onLine);
    });

    if (res.cancelado) return;
    if (!res.ok) {
      await uiAlerta(
        "Aviso",
        res.erro || "Não foi possível exportar o backup.",
        "aviso",
      );
      return;
    }

    atualizarInfoBackup();
    await uiAlerta(
      "Backup concluído",
      `Backup gerado com sucesso (${res.total} OS).`,
      "sucesso",
    );
  } catch (err) {
    console.error("Erro ao exportar backup:", err);
    await uiAlerta("Erro ao exportar", err.message || String(err), "erro");
  } finally {
    if (btn) btn.disabled = false;
    await carregarDoBancoOffline();
  }
}

async function solicitarRestauracaoComSenha() {
  const autorizado = await solicitarSenhaBackup("restaurar o backup");
  if (!autorizado) return;
  el("inputRestaurarBackup")?.click();
}

async function acionarRestaurarBackup(arquivo) {
  if (!arquivo) return;

  const btnTopo = el("btnRestaurarBackup");
  const btnInicial = el("btnInicialRestaurar");
  if (btnTopo) btnTopo.disabled = true;
  if (btnInicial) btnInicial.disabled = true;

  try {
    const res = await restaurarBackupArquivo(arquivo, (msg) => {
      setStatusIndicator(msg, !navigator.onLine);
    });

    if (!res.ok) {
      await uiAlerta(
        "Aviso",
        res.erro || "Falha ao restaurar backup.",
        "aviso",
      );
      return;
    }

    await carregarDoBancoOffline(`${res.importados} OS restaurada(s)`);
    await uiAlerta(
      "Restauração concluída",
      `Backup restaurado com sucesso (${res.importados} OS).`,
      "sucesso",
    );

    if (navigator.onLine) {
      await sincronizarNovos(false);
    }
  } catch (err) {
    console.error("Erro ao restaurar backup:", err);
    await uiAlerta("Erro ao restaurar", err.message || String(err), "erro");
  } finally {
    if (btnTopo) btnTopo.disabled = false;
    if (btnInicial) btnInicial.disabled = false;
    el("inputRestaurarBackup").value = "";
    await carregarDoBancoOffline();
  }
}

/* ---------------- Supabase Realtime ---------------- */

function iniciarRealtime() {
  if (!navigator.onLine || state.canalRealtime) return;

  const canal = supabaseClient
    .channel("painel-ordens-servico")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ordens_servico" },
      async (payload) => {
        try {
          if (payload.eventType === "DELETE") {
            const idRemovido = payload.old?.id;
            if (idRemovido != null) {
              await osCache.removerLocal(idRemovido);
              await carregarDoBancoOffline("OS removida");
            }
            return;
          }

          if (payload.new) {
            await osCache.salvarEventoRealtime(payload.new);
            const rotulo =
              payload.eventType === "INSERT" ? "+1 nova OS" : "OS atualizada";
            await carregarDoBancoOffline(rotulo);
          }
        } catch (err) {
          console.error("Erro ao processar evento Realtime:", err);
        }
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        state.realtimeAtivo = true;
        carregarDoBancoOffline();
      } else if (
        status === "CLOSED" ||
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        state.realtimeAtivo = false;
        carregarDoBancoOffline();
      }
    });

  state.canalRealtime = canal;
}

async function encerrarRealtime() {
  if (!state.canalRealtime) return;
  try {
    await supabaseClient.removeChannel(state.canalRealtime);
  } catch (e) {
    console.warn("Erro ao fechar canal Realtime:", e);
  }
  state.canalRealtime = null;
  state.realtimeAtivo = false;
}

function setStatusIndicator(texto, isOffline) {
  el("statusTexto").textContent = texto;
  el("statusFonte").classList.toggle("offline", isOffline);
}

function limparBlobUrls() {
  state.blobUrls.forEach((url) => URL.revokeObjectURL(url));
  state.blobUrls = [];
}

function adaptarPainelDb(os) {
  const fotosCache = Array.isArray(os.fotos_cache) ? os.fotos_cache : [];
  const fotosLocais = [];

  for (const f of fotosCache) {
    if (f?.blob instanceof Blob) {
      const objUrl = URL.createObjectURL(f.blob);
      state.blobUrls.push(objUrl);
      fotosLocais.push({
        src: objUrl,
        disponivelOffline: true,
        urlRemota: f.url || "",
      });
    } else if (f?.url) {
      fotosLocais.push({
        src: navigator.onLine ? f.url : "",
        disponivelOffline: false,
        urlRemota: f.url,
      });
    }
  }

  return {
    ...os,
    itens_servicos: Array.isArray(os.itens_servicos) ? os.itens_servicos : [],
    fotos_locais: fotosLocais,
    fotos_urls: fotosLocais.map((x) => x.src).filter(Boolean),
    servico_finalizado: Boolean(os.servico_finalizado),
    status: os.status || (os.servico_finalizado ? "Finalizado" : "Pendente"),
  };
}

/* ---------------- Filtros e KPIs ---------------- */

function filtrados() {
  const q = el("fBusca").value.trim().toLowerCase();
  const st = el("fStatus").value;
  const fin = el("fFinal").value;
  const ap = el("fAparelho").value;

  return state.dados.filter((o) => {
    if (q) {
      const alvo = [
        o.nome,
        o.telefone,
        o.placa,
        o.documento,
        o.servico,
        o.aparelho,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    if (st && o.status !== st) return false;
    if (fin === "1" && !o.servico_finalizado) return false;
    if (fin === "0" && o.servico_finalizado) return false;
    if (ap && o.aparelho !== ap) return false;
    return true;
  });
}

function atualizarKpis(lista) {
  const total = lista.length;
  const finalizadas = lista.filter((o) => o.servico_finalizado).length;
  const abertas = total - finalizadas;
  const soma = lista.reduce((acc, o) => acc + Number(o.valor || 0), 0);
  const aparelhosCount = new Set(lista.map((o) => o.aparelho).filter(Boolean))
    .size;

  el("kTotal").textContent = total;
  el("kTotalSub").textContent = `${aparelhosCount} aparelho(s) distinto(s)`;
  el("kAbertas").textContent = abertas;
  el("kFinalizadas").textContent = finalizadas;
  el("kTotalValor").textContent = brl(soma);
}

/* ---------------- Renderização ---------------- */

function render() {
  const aparelhos = [
    ...new Set(state.dados.map((o) => o.aparelho).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const selAp = el("fAparelho");
  const atual = selAp.value;
  selAp.innerHTML =
    '<option value="">Todos os aparelhos</option>' +
    aparelhos
      .map((a) => `<option value="${esc(a)}">${esc(a)}</option>`)
      .join("");
  if (aparelhos.includes(atual)) selAp.value = atual;

  const boxPrimeiro = el("boxPrimeiroAcesso");
  const container = el("cards");

  if (state.dados.length === 0) {
    if (boxPrimeiro) boxPrimeiro.style.display = "block";
    container.innerHTML = "";
    atualizarKpis([]);
    return;
  }

  if (boxPrimeiro) boxPrimeiro.style.display = "none";

  const lista = filtrados();
  atualizarKpis(lista);

  if (!lista.length) {
    container.innerHTML = `<div class="empty-box">Nenhuma Ordem de Serviço encontrada no banco local para os filtros aplicados.</div>`;
    return;
  }

  container.innerHTML = lista.map((o, idx) => cardHtml(o, idx)).join("");
  container.querySelectorAll(".os-card").forEach((card) => {
    card.addEventListener("click", () => {
      const idx = Number(card.dataset.idx);
      if (lista[idx]) abrirDetalhes(lista[idx]);
    });
  });
}

function cardHtml(o, idx) {
  const d = o.created_at || o.criado_em;
  const data = d ? new Date(d).toLocaleDateString("pt-BR") : "—";

  const nums = [
    o.numero_os
      ? `<span class="code-chip mono">REF ${esc(o.numero_os)}</span>`
      : "",
    o.numero_os_conserto
      ? `<span class="code-chip conserto mono">CON ${esc(o.numero_os_conserto)}</span>`
      : "",
  ].join("");

  const fotosList = (o.fotos_locais || []).filter((f) => f.src);
  const fotosHtml = fotosList.length
    ? `${fotosList
        .slice(0, 3)
        .map((f) => `<img src="${esc(f.src)}" alt="Foto OS" />`)
        .join("")}${
        fotosList.length > 3
          ? `<span class="more-photos mono">+${fotosList.length - 3}</span>`
          : ""
      }`
    : `<span class="no-photo-label">Sem fotos locais</span>`;

  const stCls = o.servico_finalizado ? "finalizado" : "pendente";
  const stTxt = o.servico_finalizado ? "Finalizado" : o.status || "Pendente";

  return `
    <article class="os-card ${o.servico_finalizado ? "is-done" : "is-open"}" data-idx="${idx}">
      <div class="card-header">
        <div>
          <div class="client-name">${esc(o.nome || "CONSUMIDOR")}</div>
          <div class="client-phone mono">${esc(o.telefone || "Sem telefone")}${o.placa ? ` · ${esc(o.placa)}` : ""}</div>
        </div>
        <span class="status-tag ${stCls}">${esc(stTxt)}</span>
      </div>

      <div class="card-meta-row">
        <div class="meta-left">
          <span class="device-discrete">${esc(o.aparelho || "Aparelho não inf.")}</span>
          <span class="mono">${esc(data)}</span>
        </div>
        <div class="os-codes">
          ${nums || `<span style="color:var(--muted)">Sem nº OS</span>`}
        </div>
      </div>

      <div class="card-service">${esc(o.servico || "Sem resumo de serviço")}</div>

      <div class="card-footer">
        <div class="card-thumbs">${fotosHtml}</div>
        <div class="card-price-box">
          <span class="card-price-label">Valor</span>
          <span class="card-price mono">${brl(o.valor)}</span>
        </div>
      </div>
    </article>
  `;
}

/* ---------------- Visualizador Interno de Fotos (Lightbox) ---------------- */

function renderizarLightbox() {
  const total = state.lightboxFotos.length;
  const item = state.lightboxFotos[state.lightboxIdx];
  const imgEl = el("lightboxImg");
  const legEl = el("lightboxLegenda");
  const prevBtn = el("btnLightboxPrev");
  const nextBtn = el("btnLightboxNext");

  if (!item) return;

  imgEl.src = item.src;
  legEl.textContent = `Foto ${state.lightboxIdx + 1} de ${total}${
    item.disponivelOffline ? " · Local (OsPainelDB)" : ""
  }`;

  const mostrarNav = total > 1;
  prevBtn.style.visibility = mostrarNav ? "visible" : "hidden";
  nextBtn.style.visibility = mostrarNav ? "visible" : "hidden";
}

function abrirLightbox(fotosValidas, indiceInicial = 0) {
  if (!Array.isArray(fotosValidas) || fotosValidas.length === 0) return;
  state.lightboxFotos = fotosValidas;
  state.lightboxIdx = Math.max(
    0,
    Math.min(indiceInicial, fotosValidas.length - 1),
  );
  renderizarLightbox();
  el("lightboxOverlay").classList.add("aberto");
}

function fecharLightbox() {
  el("lightboxOverlay").classList.remove("aberto");
  el("lightboxImg").src = "";
  state.lightboxFotos = [];
  state.lightboxIdx = 0;
}

function navegarLightbox(delta) {
  const total = state.lightboxFotos.length;
  if (total <= 1) return;
  state.lightboxIdx = (state.lightboxIdx + delta + total) % total;
  renderizarLightbox();
}

/* ---------------- Modal de Detalhes ---------------- */

function abrirDetalhes(o) {
  const itens = (o.itens_servicos || [])
    .map(
      (i) => `
      <tr>
        <td>${esc(i.servico || i.nome || "—")}</td>
        <td class="mono">${esc(i.quantidade ?? i.qtd ?? 1)}</td>
        <td class="mono">${brl(i.valor)}</td>
        <td class="mono">${esc(i.numero_os || "—")}</td>
        <td class="mono">${esc(i.numero_os_conserto || "—")}</td>
        <td>${esc(i.cor || "—")}</td>
      </tr>`,
    )
    .join("");

  const fotosValidas = (o.fotos_locais || []).filter((f) => f.src);
  const fotos = fotosValidas
    .map(
      (f, i) => `
        <button type="button" class="foto-thumb-btn" data-foto-idx="${i}" title="${
          f.disponivelOffline ? "Ampliar foto local" : "Ampliar foto"
        }">
          <img src="${esc(f.src)}" alt="Foto OS ${i + 1}" />
        </button>`,
    )
    .join("");

  const podeEditar = navigator.onLine && o.id != null;
  const d = o.created_at || o.criado_em;

  el("modalConteudo").innerHTML = `
    <div class="modal-top">
      <div>
        <h2>${esc(o.nome || "CONSUMIDOR")}</h2>
        <small class="mono">OS #${esc(o.id ?? o.uuid_local ?? "—")} · ${d ? new Date(d).toLocaleString("pt-BR") : "—"}</small>
      </div>
      <button class="btn-close" id="btnFechar" type="button" aria-label="Fechar">×</button>
    </div>

    <div class="props-grid">
      <div class="prop-item"><label>ID</label><span class="mono">${esc(o.id ?? "—")}</span></div>
      <div class="prop-item"><label>UUID Local</label><span class="mono">${esc(o.uuid_local || "—")}</span></div>
      <div class="prop-item"><label>Telefone</label><span class="mono">${esc(o.telefone || "—")}</span></div>
      <div class="prop-item"><label>Documento</label><span class="mono">${esc(o.documento || "—")}</span></div>
      <div class="prop-item"><label>Placa</label><span class="mono">${esc(o.placa || "—")}</span></div>
      <div class="prop-item"><label>Aparelho</label><span>${esc(o.aparelho || "—")}</span></div>
      <div class="prop-item"><label>Cor</label><span>${esc(o.cor || "—")}</span></div>
      <div class="prop-item"><label>Quantidade Total</label><span class="mono">${esc(o.quantidade ?? "—")}</span></div>
      <div class="prop-item"><label>Valor Total</label><span class="mono">${brl(o.valor)}</span></div>
      <div class="prop-item"><label>Desconto</label><span class="mono">${brl(o.desconto)}</span></div>
      <div class="prop-item"><label>Nº OS Reforma</label><span class="mono">${esc(o.numero_os || "—")}</span></div>
      <div class="prop-item"><label>Nº OS Conserto</label><span class="mono">${esc(o.numero_os_conserto || "—")}</span></div>
      <div class="prop-item"><label>Status</label><span>${esc(o.status || "—")}</span></div>
      <div class="prop-item"><label>Finalizado</label><span>${o.servico_finalizado ? "Sim" : "Não"}</span></div>
      <div class="prop-item full"><label>Resumo do Serviço</label><span>${esc(o.servico || "—")}</span></div>
      <div class="prop-item full"><label>Observação</label><span>${esc(o.observacao || "—")}</span></div>
      <div class="prop-item full"><label>Observação Manual</label><span>${esc(o.observacao_manual || "—")}</span></div>
    </div>

    <div class="section-heading">Itens de Serviço</div>
    <div class="items-table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th>Serviço</th>
            <th>Qtd</th>
            <th>Valor</th>
            <th>Nº OS Reforma</th>
            <th>Nº OS Conserto</th>
            <th>Cor</th>
          </tr>
        </thead>
        <tbody>${itens || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Nenhum item detalhado</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-heading">Galeria de Fotos (Local)</div>
    <div class="modal-gallery">${fotos || '<span style="color:var(--muted);font-size:13px">Nenhuma foto salva localmente nesta OS.</span>'}</div>

    <div class="modal-actions">
      ${
        podeEditar
          ? `
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button id="btnFinalizar" class="btn btn-primary" type="button">
                ${o.servico_finalizado ? "↺ Reabrir serviço" : "✓ Finalizar serviço"}
              </button>
              <button id="btnMarcarPendente" class="btn" type="button">Definir como Pendente</button>
            </div>`
          : `
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn" type="button" disabled>${o.servico_finalizado ? "↺ Reabrir serviço" : "✓ Finalizar serviço"}</button>
              <button class="btn" type="button" disabled>Definir como Pendente</button>
            </div>
            <div class="offline-banner">Modo offline: consulta e fotos locais ativas; alterações bloqueadas sem internet.</div>`
      }
    </div>
  `;

  el("modalOverlay").classList.add("aberto");
  el("btnFechar").onclick = fecharModal;

  el("modalConteudo")
    .querySelectorAll(".foto-thumb-btn")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.fotoIdx);
        abrirLightbox(fotosValidas, Number.isNaN(idx) ? 0 : idx);
      });
    });

  if (podeEditar) {
    el("btnFinalizar").onclick = () => {
      const novoFinalizado = !o.servico_finalizado;
      atualizarOS(o, {
        servico_finalizado: novoFinalizado,
        status: novoFinalizado ? "Finalizado" : "Pendente",
      });
    };
    el("btnMarcarPendente").onclick = () =>
      atualizarOS(o, { status: "Pendente", servico_finalizado: false });
  }
}

function fecharModal() {
  fecharLightbox();
  el("modalOverlay").classList.remove("aberto");
  el("modalConteudo").innerHTML = "";
}

async function atualizarOS(os, patch) {
  const btns = el("modalConteudo").querySelectorAll(".modal-actions button");
  btns.forEach((b) => (b.disabled = true));

  try {
    const { error } = await supabaseClient
      .from("ordens_servico")
      .update(patch)
      .eq("id", os.id);

    if (error) throw error;

    Object.assign(os, patch);
    try {
      const registroCache = await painelDb.ordens_servico.get(os.id);
      if (registroCache) {
        await osCache.atualizarRegistroLocal({ ...registroCache, ...patch });
      }
    } catch (cacheErr) {
      console.warn(
        "Não foi possível atualizar registro no OsPainelDB:",
        cacheErr,
      );
    }

    fecharModal();
    render();
  } catch (e) {
    await uiAlerta("Falha ao atualizar OS", e.message || String(e), "erro");
    btns.forEach((b) => (b.disabled = false));
  }
}

/* ---------------- Utilitários ---------------- */

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

/* ---------------- Eventos ---------------- */

["fBusca", "fStatus", "fFinal", "fAparelho"].forEach((id) =>
  el(id).addEventListener("input", render),
);

el("btnLimparFiltros").addEventListener("click", () => {
  el("fBusca").value = "";
  el("fStatus").value = "";
  el("fFinal").value = "";
  el("fAparelho").value = "";
  render();
});

el("btnAtualizar").addEventListener("click", () => sincronizarNovos(true));
el("btnInicialSupabase")?.addEventListener("click", () =>
  sincronizarNovos(true),
);

el("btnRestaurarBackup")?.addEventListener(
  "click",
  solicitarRestauracaoComSenha,
);
el("btnInicialRestaurar")?.addEventListener(
  "click",
  solicitarRestauracaoComSenha,
);
el("inputRestaurarBackup")?.addEventListener("change", (e) => {
  acionarRestaurarBackup(e.target.files?.[0]);
});

el("btnExportarBackup")?.addEventListener("click", acionarExportarBackup);

el("btnLightboxFechar").addEventListener("click", fecharLightbox);
el("btnLightboxPrev").addEventListener("click", () => navegarLightbox(-1));
el("btnLightboxNext").addEventListener("click", () => navegarLightbox(1));

el("lightboxOverlay").addEventListener("click", (e) => {
  if (e.target.id === "lightboxOverlay") fecharLightbox();
});

el("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") fecharModal();
});

document.addEventListener("keydown", (e) => {
  if (el("lightboxOverlay").classList.contains("aberto")) {
    if (e.key === "Escape") fecharLightbox();
    else if (e.key === "ArrowLeft") navegarLightbox(-1);
    else if (e.key === "ArrowRight") navegarLightbox(1);
    return;
  }

  if (e.key === "Escape" && el("modalOverlay").classList.contains("aberto")) {
    fecharModal();
  }
});

window.addEventListener("online", async () => {
  await sincronizarNovos(false);
  iniciarRealtime();
});

window.addEventListener("offline", async () => {
  await encerrarRealtime();
  await carregarDoBancoOffline();
});

// 1. Exibe imediatamente o que já está no OsPainelDB
// 2. Baixa apenas OS que faltam e abre o Realtime
carregarDoBancoOffline().then(async () => {
  await sincronizarNovos(false);
  iniciarRealtime();
});
