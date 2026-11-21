import { supabaseClient } from "../../js/supabase.js";
import { painelDb } from "./painel-db.js";

let sincronizando = false;

async function baixarBlobFoto(url) {
  if (!url) return null;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    return { url, blob };
  } catch (err) {
    console.warn("Falha ao baixar foto para uso offline:", url, err);
    return { url, blob: null };
  }
}

async function prepararFotosCache(urls, fotosCacheExistentes = []) {
  const mapaBlobs = new Map();
  for (const f of fotosCacheExistentes) {
    if (f?.url && f?.blob instanceof Blob) {
      mapaBlobs.set(f.url, f.blob);
    }
  }

  const resultado = [];
  for (const url of urls) {
    if (!url) continue;
    if (mapaBlobs.has(url)) {
      resultado.push({ url, blob: mapaBlobs.get(url) });
    } else if (navigator.onLine) {
      const baixado = await baixarBlobFoto(url);
      if (baixado) resultado.push(baixado);
    } else {
      resultado.push({ url, blob: null });
    }
  }
  return resultado;
}

export const osCache = {
  /**
   * Baixa APENAS OS que ainda não existem no OsPainelDB, incluindo Blobs das fotos.
   */
  async baixarNovosDoSupabase({ limite = 500, baixarImagens = true } = {}) {
    if (sincronizando || !navigator.onLine)
      return { ok: false, adicionados: 0 };
    sincronizando = true;

    try {
      const existentes = await painelDb.ordens_servico.toArray();
      const idsExistentes = new Set(
        existentes
          .map((item) => Number(item.id))
          .filter((id) => !Number.isNaN(id)),
      );
      const maiorIdLocal =
        idsExistentes.size > 0 ? Math.max(...idsExistentes) : 0;

      let query = supabaseClient
        .from("ordens_servico")
        .select("*")
        .order("id", { ascending: true })
        .limit(limite);

      if (maiorIdLocal > 0) {
        query = query.gt("id", maiorIdLocal);
      }

      const { data, error } = await query;
      if (error) throw error;

      const novos = (data || []).filter(
        (row) => !idsExistentes.has(Number(row.id)),
      );
      if (novos.length === 0) {
        return { ok: true, adicionados: 0 };
      }

      const payload = [];
      for (const os of novos) {
        const urls = Array.isArray(os.fotos_urls) ? os.fotos_urls : [];
        const fotosCache = baixarImagens
          ? await prepararFotosCache(urls, [])
          : urls.map((url) => ({ url, blob: null }));

        payload.push({
          ...os,
          itens_servicos: Array.isArray(os.itens_servicos)
            ? os.itens_servicos
            : [],
          fotos_urls: urls,
          fotos_cache: fotosCache,
          servico_finalizado: Boolean(os.servico_finalizado),
          status:
            os.status || (os.servico_finalizado ? "Finalizado" : "Pendente"),
          salvo_em: new Date().toISOString(),
        });
      }

      await painelDb.ordens_servico.bulkPut(payload);
      return { ok: true, adicionados: payload.length };
    } catch (err) {
      console.error("Erro ao baixar novas OS para o OsPainelDB:", err);
      return { ok: false, adicionados: 0 };
    } finally {
      sincronizando = false;
    }
  },

  /**
   * Salva ou atualiza uma OS recebida pelo Supabase Realtime,
   * reaproveitando Blobs locais já baixados e baixando só fotos novas.
   */
  async salvarEventoRealtime(osRemoto) {
    if (!osRemoto || osRemoto.id == null) return false;

    const existente = await painelDb.ordens_servico.get(osRemoto.id);
    const urls = Array.isArray(osRemoto.fotos_urls) ? osRemoto.fotos_urls : [];
    const fotosCache = await prepararFotosCache(
      urls,
      existente?.fotos_cache || [],
    );

    await painelDb.ordens_servico.put({
      ...(existente || {}),
      ...osRemoto,
      itens_servicos: Array.isArray(osRemoto.itens_servicos)
        ? osRemoto.itens_servicos
        : existente?.itens_servicos || [],
      fotos_urls: urls,
      fotos_cache: fotosCache,
      servico_finalizado: Boolean(osRemoto.servico_finalizado),
      status:
        osRemoto.status ||
        (osRemoto.servico_finalizado ? "Finalizado" : "Pendente"),
      atualizado_em: new Date().toISOString(),
    });

    return true;
  },

  async removerLocal(id) {
    if (id == null) return;
    await painelDb.ordens_servico.delete(id);
  },

  async listarOffline() {
    return await painelDb.ordens_servico.orderBy("id").reverse().toArray();
  },

  async atualizarRegistroLocal(osAtualizado) {
    if (!osAtualizado || osAtualizado.id == null) return;
    await painelDb.ordens_servico.put({
      ...osAtualizado,
      atualizado_em: new Date().toISOString(),
    });
  },
};
