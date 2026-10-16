// =============================================================
// Fera Fit -- "aluno nao esta mais disponivel" (D080, 2026-10-16)
//
// Decisao de Murilo (P13 = A): quando o aluno do app EXCLUI a propria
// conta, a ficha dele some do painel do parceiro na hora, sem aviso. Se o
// parceiro estiver com a ficha aberta (ou tentar salvar nela) o painel nao
// pode quebrar nem mostrar texto tecnico do banco: mostra uma frase neutra
// e volta para a lista.
//
// PONTO UNICO PARA TROCAR: quando a Backend (D155) disser o nome do codigo
// curto e estavel das funcoes da 042/044, e so colocar o codigo em CODIGOS.
// Ate la, o erro e reconhecido pelo comportamento atual (TRECHOS = trechos
// das mensagens que a 042/045 ja devolvem hoje; GRAVACAO = codigos do
// PostgREST quando um UPDATE/INSERT nao acha mais a ficha).
// =============================================================
(function (global) {
  "use strict";

  var MENSAGEM = "Este aluno não está mais disponível.";
  // Codigo estavel da Backend (D155) -- AINDA VAZIO de proposito.
  var CODIGOS = [];
  // Mensagens que a 042/045 devolvem hoje (comparacao sem acento/caixa).
  var TRECHOS = [
    "sem vinculo ativo com este aluno",
    "ficha nao encontrada",
    "vinculo nao encontrado"
  ];
  // Codigos do PostgREST/Postgres quando a linha pai nao existe mais:
  // PGRST116 (update/select .single() com 0 linhas) e 23503 (FK da medicao).
  var GRAVACAO = ["PGRST116", "23503"];

  function semAcento(texto) {
    var t = String(texto || "").toLowerCase();
    try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* navegador antigo: segue sem normalizar */ }
    return t;
  }

  // erroDoBanco: { code, message } vindo do supabase-js. opcoes.gravacao =
  // true so nos UPDATE/INSERT da ficha (onde PGRST116/23503 significam
  // "a ficha nao existe mais").
  function ehErroDoBanco(erroDoBanco, opcoes) {
    if (!erroDoBanco) { return false; }
    var codigo = erroDoBanco.code;
    if (codigo && CODIGOS.indexOf(codigo) !== -1) { return true; }
    if (opcoes && opcoes.gravacao && codigo && GRAVACAO.indexOf(codigo) !== -1) { return true; }
    var texto = semAcento(erroDoBanco.message);
    for (var i = 0; i < TRECHOS.length; i++) {
      if (texto.indexOf(TRECHOS[i]) !== -1) { return true; }
    }
    return false;
  }

  function criarErro() {
    var e = new Error(MENSAGEM);
    e.codigo = "aluno_indisponivel";
    return e;
  }

  function ehErro(e) {
    return !!(e && e.codigo === "aluno_indisponivel");
  }

  global.AlunoIndisponivel = {
    MENSAGEM: MENSAGEM,
    CODIGOS: CODIGOS,
    ehErroDoBanco: ehErroDoBanco,
    criarErro: criarErro,
    ehErro: ehErro
  };
})(typeof window !== "undefined" ? window : global);
