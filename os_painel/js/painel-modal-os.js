import { calcularTotaisOS, montarPatchOS } from "./painel-os-editor.js";
import {
  carregarCatalogoServicos,
  criarControladorPlaca,
  maskCPF,
  formatarTelefoneInteligente,
  normalizarNomeServico,
  isReforma,
  isConsertoOuSolda,
  buscarMenorNumeroLivreReforma,
  buscarMenorNumeroLivreConsertoSolda,
} from "./painel-catalogo-regras.js";

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

function calcularStatusPorDocumentos(draft) {
  if (draft?.status === "Cancelado") {
    return "Cancelado";
  }
  if (String(draft?.numero_venda || "").trim()) return "Concluído";
  if (String(draft?.registro_os || "").trim()) return "Em andamento";
  return "Pendente";
}

const inputSoftStyle =
  "width:100%;box-sizing:border-box;background:#fff;color:#1a1f26;border:1px solid #d0d5db;border-radius:6px;padding:7px 10px;font-size:13px;outline:none";

export function criarModalDetalhesOS({
  overlayId = "modalOverlay",
  conteudoId = "modalConteudo",
  onAbrirFoto,
  onAtualizarOS,
  onFechar,
} = {}) {
  const getOverlay = () => document.getElementById(overlayId);
  const getConteudo = () => document.getElementById(conteudoId);

  let osAtual = null;
  let draft = null;
  let catalogoServicos = [];
  let ctrlPlaca = null;

  function estaAberto() {
    return Boolean(getOverlay()?.classList.contains("aberto"));
  }

  function fechar() {
    if (ctrlPlaca) {
      ctrlPlaca.destruir();
      ctrlPlaca = null;
    }
    const overlay = getOverlay();
    const conteudo = getConteudo();
    if (overlay) overlay.classList.remove("aberto");
    if (conteudo) conteudo.innerHTML = "";
    osAtual = null;
    draft = null;
    if (typeof onFechar === "function") onFechar();
  }

  function definirBotoesDesabilitados(desabilitar) {
    const conteudo = getConteudo();
    if (!conteudo) return;
    conteudo.querySelectorAll("button, input, select").forEach((el) => {
      el.disabled = Boolean(desabilitar);
    });
  }

  function sincronizarCamposDoDom(conteudo) {
    if (!draft || !conteudo) return;

    const getVal = (id) => conteudo.querySelector(`#${id}`)?.value ?? "";

    draft.nome = getVal("editNome").toUpperCase();
    draft.telefone = getVal("editTelefone");
    draft.documento = getVal("editDocumento");
    draft.placa = getVal("editPlaca").toUpperCase();
    draft.aparelho = getVal("editAparelho");
    draft.cor = getVal("editCor").toUpperCase();
    draft.numero_os = getVal("editNumeroOs").trim();
    draft.numero_os_conserto = getVal("editNumeroOsConserto").trim();
    draft.registro_os = getVal("editRegistroOs").trim().toUpperCase();
    draft.numero_venda = getVal("editNumeroVenda").trim().toUpperCase();
    draft.status = calcularStatusPorDocumentos(draft);
    draft.servico_finalizado = draft.status === "Concluído";
    draft.observacao = getVal("editObservacao");
    draft.observacao_manual = getVal("editObservacaoManual");
    draft.desconto = Number(getVal("editDesconto") || 0);

    const linhas = conteudo.querySelectorAll("tr[data-item-idx]");
    const novosItens = [];
    linhas.forEach((tr) => {
      const idx = Number(tr.dataset.itemIdx);
      const base = draft.itens_servicos[idx] || {};
      const servico = normalizarNomeServico(
        tr.querySelector(".item-servico")?.value ?? "",
      );
      const quantidade = Number(tr.querySelector(".item-qtd")?.value ?? 1);
      const valorUnit = Number(tr.querySelector(".item-unit")?.value ?? 0);

      novosItens.push({
        ...base,
        servico,
        quantidade: quantidade > 0 ? quantidade : 1,
        valor_unitario: valorUnit >= 0 ? valorUnit : 0,
        valor:
          (quantidade > 0 ? quantidade : 1) * (valorUnit >= 0 ? valorUnit : 0),
      });
    });

    draft.itens_servicos = novosItens;
  }

  function atualizarResumoNaTela(conteudo) {
    if (!draft || !conteudo) return;
    const totais = calcularTotaisOS(draft.itens_servicos, draft.desconto);

    const rows = conteudo.querySelectorAll("tr[data-item-idx]");
    rows.forEach((tr, i) => {
      const calc = totais.itens[i];
      const cellTotal = tr.querySelector(".item-total-cell");
      if (cellTotal && calc) {
        cellTotal.textContent = brl(calc.valor);
      }
    });

    const elSubtotal = conteudo.querySelector("#resumoSubtotal");
    const elTotal = conteudo.querySelector("#resumoTotal");
    if (elSubtotal) elSubtotal.textContent = brl(totais.subtotal);
    if (elTotal) elTotal.textContent = brl(totais.valorFinal);
  }

  function render() {
    const overlay = getOverlay();
    const conteudo = getConteudo();
    if (!overlay || !conteudo || !osAtual || !draft) return;

    if (ctrlPlaca) {
      ctrlPlaca.destruir();
      ctrlPlaca = null;
    }

    const podeEditar = navigator.onLine && osAtual.id != null;
    const d = osAtual.created_at || osAtual.criado_em;
    const totais = calcularTotaisOS(draft.itens_servicos, draft.desconto);

    const optionsCatalogo = catalogoServicos
      .map((s) => `<option value="${esc(s.nome)}"></option>`)
      .join("");

    const estaCancelada = draft.status === "Cancelado";
    const corStatus = estaCancelada ? "#b91c1c" : "#1f5fbf";

    const linhasItens = draft.itens_servicos
      .map((item, idx) => {
        const calc = totais.itens[idx] || {
          quantidade: item.quantidade || 1,
          valor_unitario: item.valor_unitario || 0,
          valor: item.valor || 0,
        };

        return `
          <tr data-item-idx="${idx}">
            <td>
              <input type="text" list="datalistCatalogoServicos" class="item-servico" style="${inputSoftStyle}" value="${esc(item.servico ?? item.nome ?? "")}" placeholder="Serviço / produto" ${podeEditar ? "" : "disabled"} />
            </td>
            <td>
              <input type="number" min="1" step="1" class="mono item-qtd" style="${inputSoftStyle};padding:7px 6px;text-align:center" value="${esc(calc.quantidade)}" ${podeEditar ? "" : "disabled"} />
            </td>
            <td>
              <input type="number" min="0" step="0.01" class="mono item-unit" style="${inputSoftStyle};padding:7px 8px;text-align:right" value="${esc(calc.valor_unitario)}" ${podeEditar ? "" : "disabled"} />
            </td>
            <td class="mono item-total-cell" style="white-space:nowrap">${brl(calc.valor)}</td>
            <td style="text-align:center;padding-left:0;padding-right:4px">
              <button type="button" class="btn btn-remover-item" data-del-idx="${idx}" title="Excluir item" style="padding:4px 8px;min-width:0" ${podeEditar ? "" : "disabled"}>×</button>
            </td>
          </tr>
        `;
      })
      .join("");

    const fotosValidas = (osAtual.fotos_locais || []).filter((f) => f.src);
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

    conteudo.innerHTML = `
      <datalist id="datalistCatalogoServicos">${optionsCatalogo}</datalist>

      <div class="modal-top">
        <div>
          <h2>${esc(draft.nome || "CONSUMIDOR")}</h2>
          <small class="mono">OS #${esc(osAtual.id ?? osAtual.uuid_local ?? "—")} · ${d ? new Date(d).toLocaleString("pt-BR") : "—"}</small>
        </div>
        <button class="btn-close" id="btnFechar" type="button" aria-label="Fechar">×</button>
      </div>

      <div class="section-heading" style="margin-top:16px">Dados do Cliente e Veículo</div>
      <div class="props-grid" style="padding:14px;margin-top:8px">
        <div class="prop-item">
          <label for="editNome">Cliente</label>
          <input id="editNome" type="text" style="${inputSoftStyle}" value="${esc(draft.nome)}" ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item">
          <label for="editTelefone">Telefone</label>
          <input id="editTelefone" type="tel" class="mono" style="${inputSoftStyle}" value="${esc(draft.telefone)}" placeholder="+55 (00) 00000-0000" ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item">
          <label for="editDocumento">Documento</label>
          <input id="editDocumento" type="text" class="mono" maxlength="14" style="${inputSoftStyle}" value="${esc(draft.documento)}" placeholder="000.000.000-00" ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item">
          <label for="editPlaca" style="display:flex;justify-content:space-between;align-items:center">
            <span>Placa</span>
            <button type="button" id="btnModoPlaca" class="mono" style="font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid #d0d5db;background:#fff;color:#1f5fbf;cursor:pointer" ${podeEditar ? "" : "disabled"}>MERCOSUL</button>
          </label>
          <input id="editPlaca" type="text" class="mono" maxlength="7" style="${inputSoftStyle}" value="${esc(draft.placa)}" placeholder="ABC1D23" ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item">
          <label for="editAparelho">Veículo / Aparelho</label>
          <input id="editAparelho" type="text" style="${inputSoftStyle}" value="${esc(draft.aparelho)}" ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item">
          <label for="editCor">Cor</label>
          <input id="editCor" type="text" style="${inputSoftStyle}" value="${esc(draft.cor)}" placeholder="PRATA, PRETO..." ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item full">
          <label for="editObservacao">Observação</label>
          <input id="editObservacao" type="text" style="${inputSoftStyle}" value="${esc(draft.observacao)}" ${podeEditar ? "" : "disabled"} />
        </div>
        <div class="prop-item full">
          <label for="editObservacaoManual">Observação Manual</label>
          <input id="editObservacaoManual" type="text" style="${inputSoftStyle}" value="${esc(draft.observacao_manual)}" ${podeEditar ? "" : "disabled"} />
        </div>
      </div>

      <div class="section-heading">Controle da OS e Status</div>
      <div style="display:flex;flex-direction:column;gap:12px;padding:14px;margin-top:8px;border:1px solid #e3e6ea;border-radius:10px;background:#fafbfc">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
          <div class="prop-item">
            <label for="editNumeroOs">Nº OS Reforma</label>
            <input id="editNumeroOs" type="text" class="mono" style="${inputSoftStyle}" value="${esc(draft.numero_os)}" placeholder="Ex: 5907" ${podeEditar ? "" : "disabled"} />
          </div>
          <div class="prop-item">
            <label for="editNumeroOsConserto">Nº OS Conserto</label>
            <input id="editNumeroOsConserto" type="text" class="mono" style="${inputSoftStyle}" value="${esc(draft.numero_os_conserto)}" placeholder="Ex: 6201" ${podeEditar ? "" : "disabled"} />
          </div>
        </div>

        <div style="border-top:1px dashed #d8dee6;padding-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
          <div class="prop-item">
            <label for="editRegistroOs">Registro OS <span style="font-weight:400;color:#7a8494">(Em andamento)</span></label>
            <input id="editRegistroOs" type="text" class="mono" style="${inputSoftStyle}" value="${esc(draft.registro_os)}" placeholder="Ex: 0000" ${podeEditar ? "" : "disabled"} />
          </div>
          <div class="prop-item">
            <label for="editNumeroVenda">Nº Venda <span style="font-weight:400;color:#7a8494">(Concluído)</span></label>
            <input id="editNumeroVenda" type="text" class="mono" style="${inputSoftStyle}" value="${esc(draft.numero_venda)}" placeholder="Ex: 000000" ${podeEditar ? "" : "disabled"} />
          </div>
          <div class="prop-item">
            <label for="editStatus">Status</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input id="editStatus" type="text" readonly style="${inputSoftStyle};background:#f3f4f6;color:${corStatus};font-weight:600;cursor:default" value="${esc(draft.status)}" />
              <button type="button" id="btnToggleCancelar" class="btn" style="padding:7px 10px;font-size:12px;white-space:nowrap" ${podeEditar ? "" : "disabled"}>${estaCancelada ? "Reativar" : "Cancelar"}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="section-heading" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span>Itens de Serviço e Produtos</span>
        <button id="btnAdicionarItem" class="btn" type="button" ${podeEditar ? "" : "disabled"}>+ Adicionar item</button>
      </div>

      <div class="items-table-wrap" style="overflow-x:hidden">
        <table class="items-table" style="table-layout:fixed;width:100%">
          <thead>
            <tr>
              <th>Serviço / Produto</th>
              <th style="width:66px">Qtd</th>
              <th style="width:102px">Unit.</th>
              <th style="width:106px">Valor</th>
              <th style="width:38px"></th>
            </tr>
          </thead>
          <tbody>
            ${linhasItens || '<tr><td colspan="5" style="text-align:center;color:#7a8494">Nenhum item adicionado</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="items-resumo" style="display:flex;justify-content:flex-end;align-items:center;gap:18px;flex-wrap:wrap;margin-top:10px;padding:10px 14px;border-radius:8px;background:#fafbfc;border:1px solid #e3e6ea">
        <div><span style="color:#7a8494;font-size:12px">Subtotal:</span> <strong id="resumoSubtotal" class="mono">${brl(totais.subtotal)}</strong></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#7a8494">
          <span>Desconto:</span>
          <input id="editDesconto" type="number" min="0" step="0.01" class="mono" style="${inputSoftStyle};width:96px;padding:5px 8px;text-align:right" value="${esc(totais.desconto)}" ${podeEditar ? "" : "disabled"} />
        </label>
        <div><span style="color:#7a8494;font-size:12px">Total:</span> <strong id="resumoTotal" class="mono">${brl(totais.valorFinal)}</strong></div>
      </div>

      <div class="section-heading">Galeria de Fotos (Local)</div>
      <div class="modal-gallery">${fotos || '<span style="color:#7a8494;font-size:13px">Nenhuma foto salva localmente nesta OS.</span>'}</div>

      <div class="modal-actions">
        ${
          podeEditar
            ? `<button id="btnSalvarAlteracoes" class="btn btn-primary" type="button">Salvar alterações</button>`
            : `<button class="btn" type="button" disabled>Salvar alterações</button>
               <div class="offline-banner">Modo offline: consulta e fotos locais ativas; alterações bloqueadas sem internet.</div>`
        }
      </div>
    `;

    overlay.classList.add("aberto");

    conteudo.querySelector("#btnFechar")?.addEventListener("click", fechar);

    conteudo.querySelectorAll(".foto-thumb-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.fotoIdx);
        if (typeof onAbrirFoto === "function") {
          onAbrirFoto(fotosValidas, Number.isNaN(idx) ? 0 : idx);
        }
      });
    });

    if (!podeEditar || typeof onAtualizarOS !== "function") return;

    const atualizarStatusNaTela = () => {
      const inpStatus = conteudo.querySelector("#editStatus");
      const vendaVal = conteudo.querySelector("#editNumeroVenda")?.value || "";
      const regVal = conteudo.querySelector("#editRegistroOs")?.value || "";

      if (draft.status !== "Cancelado") {
        draft.status = vendaVal.trim()
          ? "Concluído"
          : regVal.trim()
            ? "Em andamento"
            : "Pendente";
      }

      if (inpStatus) {
        inpStatus.value = draft.status;
        inpStatus.style.color =
          draft.status === "Cancelado" ? "#b91c1c" : "#1f5fbf";
      }
    };

    conteudo
      .querySelector("#btnToggleCancelar")
      ?.addEventListener("click", () => {
        draft.status = draft.status === "Cancelado" ? "" : "Cancelado";
        atualizarStatusNaTela();
        const btnCancel = conteudo.querySelector("#btnToggleCancelar");
        if (btnCancel) {
          btnCancel.textContent =
            draft.status === "Cancelado" ? "Reativar" : "Cancelar";
        }
      });

    conteudo
      .querySelector("#editRegistroOs")
      ?.addEventListener("input", atualizarStatusNaTela);

    conteudo
      .querySelector("#editNumeroVenda")
      ?.addEventListener("input", atualizarStatusNaTela);

    const inpCpf = conteudo.querySelector("#editDocumento");
    inpCpf?.addEventListener("input", (e) => {
      e.target.value = maskCPF(e.target.value);
    });

    const inpTel = conteudo.querySelector("#editTelefone");
    inpTel?.addEventListener("input", (e) => {
      e.target.value = formatarTelefoneInteligente(e.target.value);
    });

    const inpPlaca = conteudo.querySelector("#editPlaca");
    const btnModoPlaca = conteudo.querySelector("#btnModoPlaca");
    if (inpPlaca) {
      ctrlPlaca = criarControladorPlaca(inpPlaca, {
        modo: "mercosul",
        onChange: (_val, _dica, modo) => {
          if (btnModoPlaca) btnModoPlaca.textContent = modo.toUpperCase();
        },
      });
      btnModoPlaca?.addEventListener("click", () => {
        ctrlPlaca?.alternarModo();
        inpPlaca.focus();
      });
    }

    conteudo.querySelectorAll(".item-servico").forEach((inp) => {
      inp.addEventListener("change", async (e) => {
        const tr = e.target.closest("tr[data-item-idx]");
        const nomeDigitado = normalizarNomeServico(e.target.value);
        e.target.value = nomeDigitado;

        const encontrado = catalogoServicos.find(
          (s) => s.nome === nomeDigitado,
        );
        const inpUnit = tr?.querySelector(".item-unit");
        if (encontrado && inpUnit && Number(inpUnit.value || 0) === 0) {
          inpUnit.value = encontrado.valor;
        }

        const inpNumReforma = conteudo.querySelector("#editNumeroOs");
        if (
          isReforma(nomeDigitado) &&
          inpNumReforma &&
          !inpNumReforma.value.trim()
        ) {
          const prox = await buscarMenorNumeroLivreReforma();
          if (prox) inpNumReforma.value = prox;
        }

        const inpNumConserto = conteudo.querySelector("#editNumeroOsConserto");
        if (
          isConsertoOuSolda(nomeDigitado) &&
          inpNumConserto &&
          !inpNumConserto.value.trim()
        ) {
          const prox = await buscarMenorNumeroLivreConsertoSolda();
          if (prox) inpNumConserto.value = prox;
        }

        sincronizarCamposDoDom(conteudo);
        atualizarResumoNaTela(conteudo);
      });
    });

    conteudo
      .querySelector("#btnAdicionarItem")
      ?.addEventListener("click", () => {
        sincronizarCamposDoDom(conteudo);
        draft.itens_servicos.push({
          servico: "",
          quantidade: 1,
          valor_unitario: 0,
          valor: 0,
        });
        render();
        const inputsServico = conteudo.querySelectorAll(".item-servico");
        inputsServico[inputsServico.length - 1]?.focus();
      });

    conteudo.querySelectorAll(".btn-remover-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        sincronizarCamposDoDom(conteudo);
        const delIdx = Number(btn.dataset.delIdx);
        if (!Number.isNaN(delIdx)) {
          draft.itens_servicos.splice(delIdx, 1);
          render();
        }
      });
    });

    conteudo
      .querySelectorAll(".item-qtd, .item-unit, #editDesconto")
      .forEach((inp) => {
        inp.addEventListener("input", () => {
          sincronizarCamposDoDom(conteudo);
          atualizarResumoNaTela(conteudo);
        });
      });

    conteudo
      .querySelector("#btnSalvarAlteracoes")
      ?.addEventListener("click", () => {
        sincronizarCamposDoDom(conteudo);
        const patch = montarPatchOS(draft);
        onAtualizarOS(osAtual, patch);
      });
  }

  async function abrir(o) {
    if (!o) return;
    osAtual = o;

    const baseDraft = {
      nome: o.nome || "",
      telefone: o.telefone || "",
      documento: o.documento || "",
      placa: o.placa || "",
      aparelho: o.aparelho || "",
      cor: o.cor || "",
      numero_os: o.numero_os || "",
      numero_os_conserto: o.numero_os_conserto || "",
      registro_os: o.registro_os || "",
      numero_venda: o.numero_venda || "",
      status: o.status === "Cancelado" ? "Cancelado" : "",
      observacao: o.observacao || "",
      observacao_manual: o.observacao_manual || "",
      servico: o.servico || "",
      desconto: Number(o.desconto || 0),
      itens_servicos: Array.isArray(o.itens_servicos)
        ? o.itens_servicos.map((it) => ({ ...it }))
        : [],
    };

    baseDraft.status = calcularStatusPorDocumentos(baseDraft);
    baseDraft.servico_finalizado = baseDraft.status === "Concluído";

    draft = baseDraft;
    render();
    catalogoServicos = await carregarCatalogoServicos();
    if (estaAberto() && osAtual === o) {
      const dl = getConteudo()?.querySelector("#datalistCatalogoServicos");
      if (dl) {
        dl.innerHTML = catalogoServicos
          .map((s) => `<option value="${esc(s.nome)}"></option>`)
          .join("");
      }
    }
  }

  getOverlay()?.addEventListener("click", (e) => {
    if (e.target.id === overlayId) fechar();
  });

  return {
    abrir,
    fechar,
    estaAberto,
    definirBotoesDesabilitados,
  };
}
