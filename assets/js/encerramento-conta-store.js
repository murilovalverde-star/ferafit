// =============================================================
// Fera Fit -- encerramento da conta do parceiro (D082, 2026-10-16)
//
// Fala com a Edge Function `delete-account` pelo contrato A10 da Backend
// (D162, STATUS dela). NADA disso esta em producao ainda: so em arquivo.
// Se a Backend ajustar o contrato, o ponto unico para mexer e ESTE arquivo.
// D084: contrato A14 (D166). Ler o aviso passou a ser {"acao":"consultar_aviso"}.
//
// Contrato (parceiro = personal ou dono de academia):
//   1) POST {"acao":"consultar_aviso"} -> 200 {ok:true, tipo_conta:"parceiro",
//      aviso_versao, imediato_aviso_versao}  (NUNCA grava nem apaga; se vier
//      tipo_conta:"aluno" o painel mostra erro e para)
//   2) POST {modo:"quarentena", aviso_versao} -> 200 {ok:true, modo,
//      recuperavel_ate}   (login bloqueado, sessoes caem)
//   3) POST {modo:"imediato", aviso_versao, imediato_aviso_versao,
//      confirmacao:"APAGAR"} (login de no maximo 5 min) -> 200 {ok:true}
// Erros: 401 reautenticacao_necessaria; 409 encerramento_ja_existe;
//   422 aviso_nao_confirmado | aviso_desatualizado | confirmacao_invalida;
//   500 falha_encerramento (+ detail).
//
// REGRA (parecer D074 da Seguranca, item 2): este arquivo NUNCA chama a funcao
// sem corpo. Chamar `chamar()` sem objeto e erro de programacao e e recusado
// aqui, antes de sair da pagina, porque na conta de aluno o corpo vazio
// era o caminho da exclusao.
// =============================================================
(function (global) {
  "use strict";

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vKEyW3okSfWu_RtxR-vbuw_Vl711Dy_";
  var LIMITE_MS = 30000; // a Backend pediu limite de 30 s com a tela "nao conseguimos concluir agora"

  var MENSAGENS = {
    encerramento_ja_existe: "Esta conta já tem um encerramento em andamento.",
    aviso_desatualizado: "O texto desta tela foi atualizado. Recarregue a página, leia de novo e confirme.",
    aviso_nao_confirmado: "Não deu para registrar a sua confirmação. Tente de novo.",
    confirmacao_invalida: "Não deu para registrar a sua confirmação. Tente de novo.",
    falha_encerramento: "Não conseguimos concluir o encerramento agora. Tente de novo em instantes; se continuar, escreva para contato@ferafit.app.br.",
    padrao: "Não conseguimos concluir agora. Tente de novo em instantes."
  };

  var Store = {};

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

  // Para os testes (Node/jsdom): injeta um cliente e um fetch falsos.
  global.EncerramentoContaStoreTestes_definirCliente = function (clienteFake, fetchFalso) {
    clienteSupabase._instancia = clienteFake;
    if (fetchFalso) { Store._fetch = fetchFalso; }
  };

  function erro(codigo, mensagem) {
    var e = new Error(mensagem);
    e.codigo = codigo;
    return e;
  }

  function token() {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    return cliente.auth.getSession().then(function (r) {
      var sessao = r && r.data && r.data.session;
      if (!sessao || !sessao.access_token) { throw erro("sem_sessao", "Sessão inválida -- faça login de novo."); }
      return sessao.access_token;
    });
  }

  function chamar(corpo) {
    if (!corpo || typeof corpo !== "object") {
      return Promise.reject(erro("corpo_obrigatorio", MENSAGENS.padrao));
    }
    return token().then(function (accessToken) {
      var f = Store._fetch || global.fetch;
      var controle = (typeof global.AbortController === "function") ? new global.AbortController() : null;
      var timer = controle ? global.setTimeout(function () { controle.abort(); }, LIMITE_MS) : null;
      var opcoes = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": "Bearer " + accessToken
        }
      };
      opcoes.body = JSON.stringify(corpo);
      if (controle) { opcoes.signal = controle.signal; }
      return f(SUPABASE_URL + "/functions/v1/delete-account", opcoes).then(function (resp) {
        if (timer) { global.clearTimeout(timer); }
        return resp.json().catch(function () { return {}; }).then(function (json) {
          return { status: resp.status, ok: resp.ok, json: json || {} };
        });
      }, function () {
        if (timer) { global.clearTimeout(timer); }
        throw erro("sem_resposta", MENSAGENS.padrao);
      });
    });
  }

  function erroDaResposta(r) {
    var codigo = r.json && r.json.error;
    if (codigo === "reautenticacao_necessaria") { return erro("reautenticacao_necessaria", "Confirme a sua senha para continuar."); }
    return erro(codigo || "falha", MENSAGENS[codigo] || MENSAGENS.padrao);
  }

  // Passo 1 (interno): descobre as versoes do aviso. Nada e gravado.
  function lerAviso() {
    return chamar({ acao: "consultar_aviso" }).then(function (r) {
      if (r.ok && r.json && r.json.ok === true && r.json.tipo_conta === "parceiro" && r.json.aviso_versao != null) {
        return { aviso_versao: r.json.aviso_versao, imediato_aviso_versao: r.json.imediato_aviso_versao };
      }
      if (r.ok) { throw erro("conta_nao_e_de_parceiro", "Esta conta não é uma conta de parceiro."); }
      throw erroDaResposta(r);
    });
  }

  // modo: "quarentena" | "imediato"
  Store.encerrar = function (modo) {
    if (modo !== "quarentena" && modo !== "imediato") {
      return Promise.reject(erro("modo_invalido", MENSAGENS.padrao));
    }
    return lerAviso().then(function (aviso) {
      var corpo = { modo: modo, aviso_versao: aviso.aviso_versao };
      if (modo === "imediato") {
        corpo.imediato_aviso_versao = aviso.imediato_aviso_versao;
        corpo.confirmacao = "APAGAR";
      }
      return chamar(corpo);
    }).then(function (r) {
      if (r.ok && r.json && r.json.ok === true) { return r.json; }
      throw erroDaResposta(r);
    });
  };

  // Login de no maximo 5 min para o "apagar agora": pede a senha de novo.
  Store.reautenticar = function (senha) {
    var cliente;
    try { cliente = clienteSupabase(); } catch (e) { return Promise.reject(e); }
    return cliente.auth.getUser().then(function (r) {
      var usuario = r && r.data && r.data.user;
      if (!usuario || !usuario.email) { throw erro("sem_sessao", "Sessão inválida -- faça login de novo."); }
      return cliente.auth.signInWithPassword({ email: usuario.email, password: senha || "" });
    }).then(function (r) {
      if (r.error) { throw erro("senha_incorreta", "Senha incorreta."); }
      return true;
    });
  };

  // Depois do 200: derruba a sessao local (o servidor ja derrubou as outras).
  Store.sairLocal = function () {
    try { return clienteSupabase().auth.signOut().catch(function () {}); } catch (e) { return Promise.resolve(); }
  };

  global.EncerramentoContaStore = Store;
})(typeof window !== "undefined" ? window : globalThis);
