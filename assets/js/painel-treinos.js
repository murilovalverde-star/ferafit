// =============================================================
// Fera Fit -- logica PURA do "Criar treino base" e da tela Inicio
// do painel do personal (reforma aprovada por Murilo em 18/10).
// Sem DOM, sem rede: so regra, para poder ser testada em Node.
//
// Formato gravado (o mesmo de treinos-store.js / D046-D050), com UM
// campo a mais por exercicio: `dia` ("A", "B"...). O banco guarda a
// lista como jsonb sem validar chave por chave (migration 022); quem
// le a lista no app precisa tolerar a chave extra -- ver STATUS.
// =============================================================
(function (global) {
  "use strict";

  var P = {};

  // Os 15 grupos do catalogo (assets/data/catalogo-exercicios.json), na ordem aprovada.
  P.GRUPOS = ["Peito", "Costas", "Ombros", "Bíceps", "Tríceps", "Antebraço", "Abdômen", "Oblíquos", "Lombar",
    "Trapézio", "Quadríceps", "Posteriores de coxa", "Glúteos", "Adutores", "Panturrilha"];

  P.DIVISOES = ["AB", "ABC", "ABCD", "ABCDE"];
  P.MAX_NOME = 80;
  P.MAX_EXERCICIOS_POR_DIA = 12;
  P.PADRAO = { series: 3, repeticoes: 10, descanso: 60 };

  P.letrasDaDivisao = function (divisao) {
    return P.DIVISOES.indexOf(divisao) === -1 ? [] : divisao.split("");
  };

  // Plano de trabalho do assistente.
  P.novoPlano = function (caminho, divisao, nome) {
    return {
      caminho: caminho === "fera" ? "fera" : "meu",
      divisao: P.DIVISOES.indexOf(divisao) === -1 ? null : divisao,
      nome: nome || "",
      dias: P.letrasDaDivisao(divisao).map(function (l) { return { letra: l, grupos: [], exercicios: [] }; })
    };
  };

  // Passo 1 -> pode seguir?
  P.validarPasso1 = function (plano) {
    if (!plano || !plano.divisao) { return "Escolha a divisão do treino (AB, ABC, ABCD ou ABCDE)."; }
    var nome = (plano.nome || "").trim();
    if (!nome) { return "Dê um nome ao treino base."; }
    if (nome.length > P.MAX_NOME) { return "O nome pode ter até " + P.MAX_NOME + " letras."; }
    return null;
  };

  // Passo 2 -> cada dia precisa de ao menos 1 musculo.
  P.validarPasso2 = function (plano) {
    for (var i = 0; i < plano.dias.length; i++) {
      if (!plano.dias[i].grupos.length) { return "Escolha ao menos um músculo no treino " + plano.dias[i].letra + "."; }
    }
    return null;
  };

  // Passo 3 -> cada dia precisa de ao menos 1 exercicio.
  P.validarPasso3 = function (plano) {
    for (var i = 0; i < plano.dias.length; i++) {
      if (!plano.dias[i].exercicios.length) { return "Escolha ao menos um exercício no treino " + plano.dias[i].letra + "."; }
    }
    return null;
  };

  P.alternarGrupo = function (dia, grupo) {
    if (P.GRUPOS.indexOf(grupo) === -1) { return dia; }
    var pos = dia.grupos.indexOf(grupo);
    if (pos === -1) { dia.grupos.push(grupo); } else { dia.grupos.splice(pos, 1); }
    // Musculo tirado: os exercicios dele saem do dia (nao ficam exercicios de musculo nao escolhido).
    dia.exercicios = dia.exercicios.filter(function (e) { return dia.grupos.indexOf(e.grupo) !== -1; });
    return dia;
  };

  // So entram no seletor do dia os exercicios dos musculos escolhidos.
  P.catalogoDoDia = function (catalogo, dia) {
    return (catalogo || []).filter(function (ex) { return dia.grupos.indexOf(ex.grupo) !== -1; });
  };

  // Item gravavel. `mapaSrc` = idCatalogoSite -> srcMotor (MAPA_ID_MOTOR_PARA_CATALOGO_190.json).
  P.itemDoCatalogo = function (ex, mapaSrc, letra, anterior) {
    var src = mapaSrc && mapaSrc[ex.id];
    if (!src) { return null; }
    var p = anterior || {};
    return { grupo: ex.grupo, subgrupo: ex.subgrupo, src: src, series: p.series || P.PADRAO.series,
      repeticoes: p.repeticoes || P.PADRAO.repeticoes, descanso: p.descanso || P.PADRAO.descanso, dia: letra };
  };

  // Liga/desliga um exercicio no dia. Devolve "limite" quando passa do maximo por dia.
  P.alternarExercicio = function (dia, ex, mapaSrc) {
    var src = mapaSrc && mapaSrc[ex.id];
    if (!src) { return "indisponivel"; }
    for (var i = 0; i < dia.exercicios.length; i++) {
      if (dia.exercicios[i].src === src) { dia.exercicios.splice(i, 1); return "removido"; }
    }
    if (dia.exercicios.length >= P.MAX_EXERCICIOS_POR_DIA) { return "limite"; }
    dia.exercicios.push(P.itemDoCatalogo(ex, mapaSrc, dia.letra));
    return "adicionado";
  };

  P.ajustarPrescricao = function (item, campo, valor) {
    if (["series", "repeticoes", "descanso"].indexOf(campo) === -1) { return false; }
    var n = parseInt(valor, 10);
    if (isNaN(n) || n < 1) { return false; }
    if (campo === "series" && n > 20) { return false; }
    if (campo === "repeticoes" && n > 100) { return false; }
    if (campo === "descanso" && n > 900) { return false; }
    item[campo] = n;
    return true;
  };

  // Plano -> lista plana gravavel (ordem A, B, C...).
  P.planoParaLista = function (plano) {
    var lista = [];
    plano.dias.forEach(function (d) {
      d.exercicios.forEach(function (e) {
        lista.push({ grupo: e.grupo, subgrupo: e.subgrupo, src: e.src, series: e.series, repeticoes: e.repeticoes, descanso: e.descanso, dia: d.letra });
      });
    });
    return lista;
  };

  // Lista gravada -> plano (para editar). Lista sem `dia` em algum item = treino antigo (editor simples).
  P.ehTreinoComDias = function (lista) {
    return Array.isArray(lista) && lista.length > 0 && lista.every(function (e) { return typeof e.dia === "string" && /^[A-E]$/.test(e.dia); });
  };

  P.listaParaPlano = function (nome, lista) {
    if (!P.ehTreinoComDias(lista)) { return null; }
    var letras = [];
    lista.forEach(function (e) { if (letras.indexOf(e.dia) === -1) { letras.push(e.dia); } });
    letras.sort();
    var divisao = letras.join("");
    if (P.DIVISOES.indexOf(divisao) === -1) { return null; }
    var plano = P.novoPlano("meu", divisao, nome);
    lista.forEach(function (e) {
      var dia = plano.dias.filter(function (d) { return d.letra === e.dia; })[0];
      if (dia.grupos.indexOf(e.grupo) === -1) { dia.grupos.push(e.grupo); }
      dia.exercicios.push({ grupo: e.grupo, subgrupo: e.subgrupo, src: e.src, series: e.series, repeticoes: e.repeticoes, descanso: e.descanso, dia: e.dia });
    });
    return plano;
  };

  // Resposta de um motor externo (window.MotorFeraSite.gerarTreino) -> plano editavel, ou null se o formato nao serve.
  // Formato esperado: { dias: [ { letra: "A", exercicios: [ {grupo, subgrupo, src, series, repeticoes, descanso} ] } ] }
  P.respostaDoMotorParaPlano = function (nome, resposta) {
    if (!resposta || !Array.isArray(resposta.dias) || !resposta.dias.length) { return null; }
    var letras = resposta.dias.map(function (d) { return d && d.letra; });
    var divisao = letras.join("");
    if (P.DIVISOES.indexOf(divisao) === -1) { return null; }
    var plano = P.novoPlano("fera", divisao, nome);
    for (var i = 0; i < resposta.dias.length; i++) {
      var exs = resposta.dias[i].exercicios;
      if (!Array.isArray(exs) || !exs.length) { return null; }
      for (var j = 0; j < exs.length; j++) {
        var e = exs[j];
        if (!e || !e.src || !e.grupo || P.GRUPOS.indexOf(e.grupo) === -1) { return null; }
        var dia = plano.dias[i];
        if (dia.grupos.indexOf(e.grupo) === -1) { dia.grupos.push(e.grupo); }
        dia.exercicios.push({ grupo: e.grupo, subgrupo: e.subgrupo || "", src: e.src, series: e.series || P.PADRAO.series,
          repeticoes: e.repeticoes || P.PADRAO.repeticoes, descanso: e.descanso || P.PADRAO.descanso, dia: dia.letra });
      }
    }
    return plano;
  };

  // ---- Tela Inicio -------------------------------------------------
  // linhas: saida de PainelAlunos.montarLinhas (ja ordenada). PA = PainelAlunos.
  P.resumoInicio = function (PA, linhas, hoje, treinosBase, desvinculados, limiteAlunos) {
    var c = PA.contagemPagamentos(linhas, hoje);
    var faltou = linhas.filter(function (l) { return l.faltou2 === true; }).length;
    var temFreq = linhas.some(function (l) { return l.faltou2 === true || l.faltou2 === false; });
    var expirando = (desvinculados || []).filter(function (d) {
      var fim = new Date(d.expira_em).getTime();
      if (isNaN(fim)) { return false; }
      return (fim - hoje.getTime()) / 86400000 <= 7;
    }).length;
    return {
      ativos: PA.contarAtivos(linhas),
      limite: (typeof limiteAlunos === "number" && limiteAlunos > 0) ? limiteAlunos : null,
      atrasados: c.atrasados,
      vencemSemana: c.semana,
      faltaram2: temFreq ? faltou : null,
      treinosBase: Array.isArray(treinosBase) ? treinosBase.length : null,
      desvinculadosExpirando: expirando
    };
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = P; }
  global.PainelTreinos = P;
})(typeof window !== "undefined" ? window : globalThis);
