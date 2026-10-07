// =============================================================
// Fera Fit — Camada de dados da config de carga por exercício
// (anilha/seletor), contra a tabela real `academia_config_carga_exercicio`
// (migration 034).
//
// D062 do Orquestrador (2026-10-07): liga a tela "Aparelhos de
// carga" (parceiro.html, D055/D056/D057) ao banco de verdade --
// até aqui ela só gravava em localStorage. Esquema lido (só
// leitura, nada gravado na pasta da Backend) direto do arquivo
// `034_config_carga_por_exercicio_do_parceiro.sql`.
//
// Só ACADEMIA (D057/D123) -- a tabela nem tem coluna de personal_id.
// Chave natural (academia_id, exercicio_src) -- é o índice único
// real da 034, usado aqui com upsert (onConflict). `exercicio_src`
// é o id do MOTOR do app (mesmo padrão de
// treino_series.exercicio_src/018 e de treinos-store.js/fichas-store.js
// deste projeto) -- NUNCA o id do catálogo do site; quem traduz um
// para o outro é a própria tela (mapaSrcPorIdCatalogo em
// parceiro.html) -- este arquivo só grava/lê o que já chega pronto.
//
// Só a chave `publishable`, nunca `service_role` -- a RLS da própria
// 034 já restringe cada academia à própria linha (policies "dono lê
// /grava/atualiza/apaga", via `sou_a_academia(academia_id)`).
// =============================================================

(function (global) {
  "use strict";

  var CargaConfigStoreSupabase = {};

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vKEyW3okSfWu_RtxR-vbuw_Vl711Dy_";

  function clienteSupabase() {
    if (clienteSupabase._instancia) {
      return clienteSupabase._instancia;
    }
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      throw new Error("Biblioteca do Supabase (assets/js/supabase.js) não está carregada nesta página.");
    }
    clienteSupabase._instancia = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return clienteSupabase._instancia;
  }

  // Permite injetar um cliente fake nos testes (Node.js, sem window.supabase real).
  global.CargaConfigStoreSupabaseTestes_definirCliente = function (clienteFake) {
    clienteSupabase._instancia = clienteFake;
  };

  // Lista todas as linhas da academia logada. A RLS já restringe
  // à própria academia (sou_a_academia) -- filtramos explicitamente
  // por clareza e para nunca depender só da policy.
  CargaConfigStoreSupabase.listarMinhasConfigs = function (academiaId) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    if (!academiaId) {
      return Promise.resolve([]);
    }
    return cliente.from("academia_config_carga_exercicio").select("*").eq("academia_id", academiaId)
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para carregar os aparelhos de carga agora.");
        }
        return resultado.data || [];
      });
  };

  // Grava (cria ou atualiza) a config de um exercício -- chave
  // natural (academia_id, exercicio_src), igual ao índice único real
  // da 034. `primeiroPeso`/`ultimoPeso` só valem para 'seletor' -- o
  // próprio banco recusaria (CHECK) se vierem preenchidos com
  // tipoCarga='anilha'; aqui já mandamos null nesse caso, por
  // clareza e para não depender só do banco recusar.
  CargaConfigStoreSupabase.salvarConfig = function (academiaId, exercicioSrc, tipoCarga, primeiroPeso, ultimoPeso) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    if (!academiaId || !exercicioSrc) {
      return Promise.reject(new Error("Faltou identificar a academia ou o exercício."));
    }
    if (tipoCarga !== "anilha" && tipoCarga !== "seletor") {
      return Promise.reject(new Error("Tipo de carga inválido."));
    }
    var corpo = {
      academia_id: academiaId,
      exercicio_src: exercicioSrc,
      tipo_carga: tipoCarga,
      primeiro_peso: (tipoCarga === "seletor" && primeiroPeso != null) ? primeiroPeso : null,
      ultimo_peso: (tipoCarga === "seletor" && ultimoPeso != null) ? ultimoPeso : null
    };
    return cliente.from("academia_config_carga_exercicio")
      .upsert(corpo, { onConflict: "academia_id,exercicio_src" })
      .select("*").single()
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para salvar esse aparelho agora.");
        }
        return resultado.data;
      });
  };

  // Desmarca por completo (clicar de novo no mesmo tipo, na tela) --
  // apaga a linha, não deixa um registro "vazio" sobrando na tabela.
  CargaConfigStoreSupabase.removerConfig = function (academiaId, exercicioSrc) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    if (!academiaId || !exercicioSrc) {
      return Promise.reject(new Error("Faltou identificar a academia ou o exercício."));
    }
    return cliente.from("academia_config_carga_exercicio")
      .delete().eq("academia_id", academiaId).eq("exercicio_src", exercicioSrc)
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para remover esse aparelho agora.");
        }
        return true;
      });
  };

  global.CargaConfigStore = CargaConfigStoreSupabase;
  global.CargaConfigStoreSupabase = CargaConfigStoreSupabase;
})(typeof window !== "undefined" ? window : global);
