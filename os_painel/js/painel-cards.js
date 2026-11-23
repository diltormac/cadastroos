import { supabaseClient } from "../../js/supabase.js";
import { painelDb } from "./painel-db.js";
import { osCache } from "./os-cache.js";
import { uiAlerta } from "./ui-alerta.js";

export function criarGerenciadorCards({
  state,
  modalOS,
  atualizarKpisPainel,
  esc,
  brl,
  getEl = (id) => document.getElementById(id),
} = {}) {
  function filtrados() {
    const q = (getEl("fBusca")?.value || "").trim().toLowerCase();
    const st = getEl("fStatus")?.value || "";
    const fin = getEl("fFinal")?.value || "";
    const ap = getEl("fAparelho")?.value || "";

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

    const detalhes = [
      o.cor ? `<span class="detail-pill">Cor: ${esc(o.cor)}</span>` : "",
      o.quantidade != null && o.quantidade !== ""
        ? `<span class="detail-pill mono">Qtd: ${esc(o.quantidade)}</span>`
        : "",
      Number(o.desconto || 0) > 0
        ? `<span class="detail-pill mono">Desc: ${brl(o.desconto)}</span>`
        : "",
    ]
      .filter(Boolean)
      .join("");

    const limiteFotosCard = 2;
    const fotosList = (o.fotos_locais || []).filter((f) => f.src);
    const fotosHtml = fotosList.length
      ? `${fotosList
          .slice(0, limiteFotosCard)
          .map(
            (f) => `<img src="${esc(f.src)}" alt="Foto OS" loading="lazy" />`,
          )
          .join("")}${
          fotosList.length > limiteFotosCard
            ? `<span class="more-photos mono">+${fotosList.length - limiteFotosCard}</span>`
            : ""
        }`
      : `<span class="no-photo-label">Sem fotos locais</span>`;

    const stCls = o.servico_finalizado ? "finalizado" : "pendente";
    const stTxt = o.servico_finalizado ? "Finalizado" : o.status || "Pendente";
    const resumoTexto =
      o.servico ||
      o.observacao ||
      o.observacao_manual ||
      "Sem resumo de serviço";

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

        ${detalhes ? `<div class="card-details-strip">${detalhes}</div>` : ""}

        <div class="card-service">${esc(resumoTexto)}</div>

        <div class="card-footer" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div class="card-thumbs" style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;flex:1 1 auto">${fotosHtml}</div>
          <div class="card-price-box" style="flex-shrink:0;white-space:nowrap">
            <span class="card-price-label">Valor</span>
            <span class="card-price mono">${brl(o.valor)}</span>
          </div>
        </div>
      </article>
    `;
  }

  function render() {
    const aparelhos = [
      ...new Set(state.dados.map((o) => o.aparelho).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "pt-BR"));

    const selAp = getEl("fAparelho");
    if (selAp) {
      const atual = selAp.value;
      selAp.innerHTML =
        '<option value="">Todos os aparelhos</option>' +
        aparelhos
          .map((a) => `<option value="${esc(a)}">${esc(a)}</option>`)
          .join("");
      if (aparelhos.includes(atual)) selAp.value = atual;
    }

    const boxPrimeiro = getEl("boxPrimeiroAcesso");
    const container = getEl("cards");
    if (!container) return;

    if (state.dados.length === 0) {
      if (boxPrimeiro) boxPrimeiro.style.display = "block";
      container.innerHTML = "";
      atualizarKpisPainel([]);
      return;
    }

    if (boxPrimeiro) boxPrimeiro.style.display = "none";

    const lista = filtrados();
    atualizarKpisPainel(lista);

    if (!lista.length) {
      container.innerHTML = `<div class="empty-box">Nenhuma Ordem de Serviço encontrada no banco local para os filtros aplicados.</div>`;
      return;
    }

    container.innerHTML = lista.map((o, idx) => cardHtml(o, idx)).join("");
    container.querySelectorAll(".os-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = Number(card.dataset.idx);
        if (lista[idx]) modalOS.abrir(lista[idx]);
      });
    });
  }

  async function atualizarOS(os, patch) {
    modalOS.definirBotoesDesabilitados(true);

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

      modalOS.fechar();
      render();
    } catch (e) {
      await uiAlerta("Falha ao atualizar OS", e.message || String(e), "erro");
      modalOS.definirBotoesDesabilitados(false);
    }
  }

  return {
    filtrados,
    render,
    atualizarOS,
  };
}
