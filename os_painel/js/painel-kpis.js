function formatarMoedaBrl(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function montarKpisPainel(alvoSeletor = "#kpisSlot") {
  const alvo =
    typeof alvoSeletor === "string"
      ? document.querySelector(alvoSeletor)
      : alvoSeletor;

  if (!alvo) return null;

  alvo.innerHTML = `
    <section class="kpi-grid" aria-label="Indicadores das Ordens de Serviço">
      <div class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-label">Total de OS</span>
          <span class="kpi-badge">📋</span>
        </div>
        <div class="kpi-value mono" id="kTotal">—</div>
        <div class="kpi-sub" id="kTotalSub">Carregando registros</div>
      </div>

      <div class="kpi-card amber">
        <div class="kpi-top">
          <span class="kpi-label">Em Aberto</span>
          <span class="kpi-badge">⏳</span>
        </div>
        <div class="kpi-value mono" id="kAbertas">—</div>
        <div class="kpi-sub">Não finalizadas</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-label">Finalizadas</span>
          <span class="kpi-badge">✅</span>
        </div>
        <div class="kpi-value mono" id="kFinalizadas">—</div>
        <div class="kpi-sub">Serviço finalizado</div>
      </div>

      <div class="kpi-card sky">
        <div class="kpi-top">
          <span class="kpi-label">Soma Total</span>
          <span class="kpi-badge">💰</span>
        </div>
        <div class="kpi-value mono" id="kTotalValor">—</div>
        <div class="kpi-sub">Valor das OS listadas</div>
      </div>
    </section>
  `;

  return alvo.querySelector(".kpi-grid");
}

export function atualizarKpisPainel(lista = []) {
  const total = lista.length;
  const finalizadas = lista.filter((o) => o.servico_finalizado).length;
  const abertas = total - finalizadas;
  const soma = lista.reduce((acc, o) => acc + Number(o.valor || 0), 0);
  const aparelhosCount = new Set(lista.map((o) => o.aparelho).filter(Boolean))
    .size;

  const elTotal = document.getElementById("kTotal");
  const elSub = document.getElementById("kTotalSub");
  const elAbertas = document.getElementById("kAbertas");
  const elFinalizadas = document.getElementById("kFinalizadas");
  const elValor = document.getElementById("kTotalValor");

  if (elTotal) elTotal.textContent = total;
  if (elSub) elSub.textContent = `${aparelhosCount} aparelho(s) distinto(s)`;
  if (elAbertas) elAbertas.textContent = abertas;
  if (elFinalizadas) elFinalizadas.textContent = finalizadas;
  if (elValor) elValor.textContent = formatarMoedaBrl(soma);
}
