// =============================================================
// Fera Fit -- controle MANUAL de pagamentos do personal (D083 / D086)
//
// O personal anota valor e dia de vencimento de cada aluno e marca o mes
// como pago. O Fera Fit NAO processa pagamento, nao guarda dado de cartao,
// banco ou PIX -- so o que o personal digita aqui.
//
// Fala com as RPCs REAIS da migration 053 (em producao desde 17/10):
//   pagamentos_das_minhas_fichas()   leitura (uma linha por ficha com controle)
//   definir_controle_pagamento(p_ficha_id, p_valor (reais), p_dia_vencimento, p_inicio_em)
//   remover_controle_pagamento(p_ficha_id)
//   marcar_pagamento_mes(p_ficha_id, p_competencia, p_pago)
//   frequencia_dos_meus_alunos()     leitura ("faltou 2 treinos", definicao provisoria P108)
// A situacao (pago / a_vencer / atrasado) e calculada PELO BANCO; o site so
// mostra. Chave da ficha = "f:<ficha_id>". Chave publishable apenas.
// Erros do banco sao reconhecidos pela MENSAGEM exata (nunca pelo codigo SQL).
// =============================================================
(function (global) {
  "use strict";

  var Store = {};
  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vKEyW3okSfWu_RtxR-vbuw_Vl711Dy_";

  function clienteSupabase() {
    if (clienteSupabase._instancia) { return clienteSupabase._instancia; }
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      throw new Error("Biblioteca do Supabase (assets/js/supabase.js) não está carregada nesta página.");
    }
    clienteSupabase._instancia = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return clienteSupabase._instancia;
  }
  global.PagamentosStoreTestes_definirCliente = function (c) { clienteSupabase._instancia = c; };

  function erro(codigo, mensagem) { var e = new Error(mensagem); e.codigo = codigo; return e; }

  Store.TEXTO_INDISPONIVEL = "Os pagamentos ainda não estão disponíveis.";

  var MENSAGENS = {
    aluno_inexistente: "Este aluno não existe mais na sua lista.",
    ficha_so_leitura: "Este aluno está desvinculado: o pagamento fica só para consulta.",
    sem_controle_pagamento: "Cadastre o valor e o dia do vencimento antes de marcar o mês.",
    valor_invalido: "Digite um valor válido, de zero para cima.",
    dia_invalido: "O dia do vencimento vai de 1 a 31.",
    competencia_invalida: "Esse mês não pode ser marcado."
  };

  function funcaoAusente(e) {
    var t = ((e && e.message) || "").toLowerCase();
    return !!e && (e.code === "PGRST202" || e.code === "42883" ||
      t.indexOf("could not find the function") !== -1 || (t.indexOf("function") !== -1 && t.indexOf("does not exist") !== -1));
  }
  function traduzir(e, padrao) {
    if (funcaoAusente(e)) { return erro("indisponivel", Store.TEXTO_INDISPONIVEL); }
    var m = e && e.message;
    if (typeof m === "string" && Object.prototype.hasOwnProperty.call(MENSAGENS, m)) { return erro(m, MENSAGENS[m]); }
    return erro("falha", padrao);
  }

  Store.chave = function (p) { return p && p.ficha_id != null ? "f:" + p.ficha_id : null; };

  function paraPagamento(r) {
    var valor = Number(r.valor);
    return {
      ficha_id: r.ficha_id,
      valor_centavos: Math.round(valor * 100),
      dia_vencimento: Number(r.dia_vencimento),
      inicio_em: r.inicio_em || null,
      competencia_atual: r.competencia_atual || null,
      vencimento_atual: r.vencimento_atual || null,
      pago_mes_atual: r.pago_mes_atual === true,
      meses_em_atraso: Number(r.meses_em_atraso) || 0,
      situacao: r.situacao,
      so_leitura: r.so_leitura === true,
      ultimos_meses_pagos: Array.isArray(r.ultimos_meses_pagos) ? r.ultimos_meses_pagos : []
    };
  }

  // Devolve { "f:12": {...} }.
  Store.listar = function () {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    return cliente.rpc("pagamentos_das_minhas_fichas", {}).then(function (r) {
      if (r.error) { throw traduzir(r.error, "Não deu para carregar os pagamentos agora."); }
      var mapa = {};
      (r.data || []).forEach(function (p) { var k = Store.chave(p); if (k) { mapa[k] = paraPagamento(p); } });
      return mapa;
    });
  };

  // Devolve { "f:12": {ficha_id, faltou_2_treinos, ...} } so de aluno do app com vinculo ativo.
  Store.listarFrequencia = function () {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    return cliente.rpc("frequencia_dos_meus_alunos", {}).then(function (r) {
      if (r.error) { throw traduzir(r.error, "Não deu para carregar a frequência agora."); }
      var mapa = {};
      (r.data || []).forEach(function (f) { var k = Store.chave(f); if (k) { mapa[k] = f; } });
      return mapa;
    });
  };

  // dados: { valor_centavos, dia_vencimento }. O banco recebe REAIS (numeric).
  Store.salvarCobranca = function (fichaId, dados) {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    var valor = Number(dados && dados.valor_centavos);
    var dia = Number(dados && dados.dia_vencimento);
    if (fichaId == null) { return Promise.reject(erro("alvo_invalido", "Aluno não identificado.")); }
    if (!(valor > 0) || Math.round(valor) !== valor) { return Promise.reject(erro("valor_invalido", "Digite um valor maior que zero.")); }
    if (!(dia >= 1 && dia <= 31) || Math.round(dia) !== dia) { return Promise.reject(erro("dia_invalido", MENSAGENS.dia_invalido)); }
    return cliente.rpc("definir_controle_pagamento", {
      p_ficha_id: fichaId, p_valor: valor / 100, p_dia_vencimento: dia
    }).then(function (r) {
      if (r.error) { throw traduzir(r.error, "Não deu para salvar a cobrança agora."); }
      return Store.listar();
    });
  };

  // Marca (pago=true) ou desmarca o mes da ficha. competencia 'AAAA-MM-01' (padrao: o mes atual do banco).
  Store.marcarMes = function (fichaId, competencia, pago) {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    if (fichaId == null || !competencia) { return Promise.reject(erro("alvo_invalido", "Cobrança não encontrada.")); }
    return cliente.rpc("marcar_pagamento_mes", {
      p_ficha_id: fichaId, p_competencia: competencia, p_pago: pago !== false
    }).then(function (r) {
      if (r.error) { throw traduzir(r.error, "Não deu para marcar o pagamento agora."); }
      return Store.listar();
    });
  };

  Store.remover = function (fichaId) {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    if (fichaId == null) { return Promise.reject(erro("alvo_invalido", "Aluno não identificado.")); }
    return cliente.rpc("remover_controle_pagamento", { p_ficha_id: fichaId }).then(function (r) {
      if (r.error) { throw traduzir(r.error, "Não deu para remover a cobrança agora."); }
      return Store.listar();
    });
  };

  global.PagamentosStore = Store;
})(typeof window !== "undefined" ? window : globalThis);
