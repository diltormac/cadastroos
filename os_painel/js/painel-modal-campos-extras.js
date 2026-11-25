import { normalizarNomeServico } from "./painel-catalogo-regras.js";

export const btnCopiarCampoStyle =
  "font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid #d0d5db;background:#fff;color:#334155;cursor:pointer";

export const btnWhatsAppCampoStyle =
  "font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid #16a34a;background:#16a34a;color:#fff;cursor:pointer";

export function renderBotaoCopiar(targetId) {
  return `<button type="button" class="btn-copiar-campo" data-copiar-target="${targetId}" style="${btnCopiarCampoStyle}">Copiar</button>`;
}

export function renderBotoesTelefoneExtras(targetId = "editTelefone") {
  return `
    <span style="display:inline-flex;gap:4px">
      ${renderBotaoCopiar(targetId)}
      <button type="button" id="btnWhatsAppTelefone" style="${btnWhatsAppCampoStyle}">WhatsApp</button>
    </span>
  `;
}

export async function copiarTextoCampo(valor, btn) {
  const texto = String(valor || "").trim();
  if (!texto) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
    } else {
      const aux = document.createElement("textarea");
      aux.value = texto;
      aux.style.position = "fixed";
      aux.style.opacity = "0";
      document.body.appendChild(aux);
      aux.select();
      document.execCommand("copy");
      aux.remove();
    }

    if (btn) {
      const anterior = btn.textContent;
      btn.textContent = "Copiado!";
      setTimeout(() => {
        btn.textContent = anterior;
      }, 1200);
    }
  } catch (err) {
    console.warn("Falha ao copiar:", err);
  }
}

export function normalizarTelefoneWhatsApp(valor) {
  let digitos = String(valor || "").replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.length === 10 || digitos.length === 11) {
    digitos = `55${digitos}`;
  }
  return digitos;
}

export function abrirWhatsAppComMensagem(telefoneBruto, mensagem) {
  const numero = normalizarTelefoneWhatsApp(telefoneBruto);
  if (!numero) return false;
  const texto = String(mensagem || "").trim();
  const url = texto
    ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/${numero}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export function forcarCapsLockAoDigitar(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    if (typeof pos === "number") e.target.setSelectionRange(pos, pos);
  });
}

export function sincronizarServicosNaObservacao(conteudo, draft) {
  if (!draft || !conteudo) return;
  const inpObs = conteudo.querySelector("#editObservacao");
  if (!inpObs) return;

  const nomesServicos = [
    ...new Set(
      (draft.itens_servicos || [])
        .map((it) => normalizarNomeServico(it?.servico ?? it?.nome ?? ""))
        .filter(Boolean),
    ),
  ];

  const blocoServicos = nomesServicos.length
    ? `SERVIÇOS: ${nomesServicos.join(", ")}`
    : "";

  const atual = String(inpObs.value || "").toUpperCase();
  const partes = atual
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  const outrasPartes = partes.filter((p) => !p.startsWith("SERVIÇOS:"));
  const combinadas = blocoServicos
    ? [blocoServicos, ...outrasPartes]
    : outrasPartes;

  const novoTexto = combinadas.join(" | ");
  inpObs.value = novoTexto;
  draft.observacao = novoTexto;
}

export function bindCamposExtrasModal(
  conteudo,
  {
    getDraft,
    getOsAtual,
    calcularTotaisOS,
    montarTextoCompartilhamento,
    sincronizarCamposDoDom,
    onTelefoneInvalido,
  } = {},
) {
  if (!conteudo) return;

  conteudo.querySelectorAll(".btn-copiar-campo").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const alvoId = btn.dataset.copiarTarget;
      const val = conteudo.querySelector(`#${alvoId}`)?.value ?? "";
      copiarTextoCampo(val, btn);
    });
  });

  conteudo
    .querySelector("#btnWhatsAppTelefone")
    ?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const draft = typeof getDraft === "function" ? getDraft() : null;
      const osAtual = typeof getOsAtual === "function" ? getOsAtual() : null;
      if (!draft) return;

      const telAtual =
        conteudo.querySelector("#editTelefone")?.value ?? draft.telefone;

      if (!normalizarTelefoneWhatsApp(telAtual)) {
        if (typeof onTelefoneInvalido === "function") {
          await onTelefoneInvalido();
        }
        return;
      }

      if (typeof sincronizarCamposDoDom === "function") {
        sincronizarCamposDoDom(conteudo);
      }
      sincronizarServicosNaObservacao(conteudo, draft);

      const tot =
        typeof calcularTotaisOS === "function"
          ? calcularTotaisOS(draft.itens_servicos, draft.desconto)
          : null;
      const msg =
        typeof montarTextoCompartilhamento === "function"
          ? montarTextoCompartilhamento(osAtual, draft, tot)
          : "";

      abrirWhatsAppComMensagem(telAtual, msg);
    });

  forcarCapsLockAoDigitar(conteudo.querySelector("#editNome"));
  forcarCapsLockAoDigitar(conteudo.querySelector("#editObservacao"));
  conteudo.querySelectorAll(".item-servico").forEach((inp) => {
    forcarCapsLockAoDigitar(inp);
  });
}
