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

  // D090/D091 -- divisoes oferecidas (decisao de Murilo 18/10, iguais as da App D282): Full Body, AB, ABC, ABCDE e
  // Legs Everyday. Nomes/descricoes/musculos = os do app (V37/src/domain/splits.js e onboarding/Divisao.js).
  // `dia` gravado: "A".."G" em todas (Legs Everyday grava A..E e mostra "Dia 1".."Dia 5").
  // Full Body e variavel: de 3 a 7 dias (`min`/`max`), cada dia com a sua lista.
  var TODOS = ["Peito", "Costas", "Ombros", "Bíceps", "Tríceps", "Antebraço", "Abdômen", "Oblíquos", "Lombar",
    "Trapézio", "Quadríceps", "Posteriores de coxa", "Glúteos", "Adutores", "Panturrilha"];
  P.LETRAS = ["A", "B", "C", "D", "E", "F", "G"];
  function dia(letra, rotulo, foco, grupos) { return { letra: letra, rotulo: rotulo, foco: foco, grupos: grupos }; }
  var LE_SUP = ["Abdômen", "Oblíquos", "Lombar", "Peito", "Ombros", "Tríceps", "Costas", "Trapézio", "Bíceps"];
  P.DIVISOES = [
    { id: "full_body", nome: "Full Body", subtitulo: "Corpo inteiro, de 3 a 7 treinos", variavel: true, min: 3, max: 7,
      descricao: "Corpo todo em um único treino: ganhe força, queime calorias e otimize seu tempo ao máximo.",
      nota: "Você monta de 3 a 7 treinos de corpo inteiro (A, B, C…), cada um com a sua lista. Para o aluno, eles se alternam em ciclo.",
      dias: [0, 1, 2].map(function (i) { return dia(P.LETRAS[i], "Treino " + P.LETRAS[i], "Corpo inteiro", TODOS.slice()); }) },
    { id: "ab", nome: "AB", subtitulo: "Upper / Lower",
      descricao: "Divisão inteligente: treine metade do corpo no dia A e a outra metade no dia B com eficácia.",
      dias: [dia("A", "Treino A", "Superior", ["Peito", "Costas", "Trapézio", "Ombros", "Bíceps", "Tríceps", "Antebraço"]),
             dia("B", "Treino B", "Inferior", ["Quadríceps", "Posteriores de coxa", "Glúteos", "Adutores", "Panturrilha", "Abdômen", "Oblíquos", "Lombar"])] },
    { id: "abc", nome: "ABC", subtitulo: "Push / Pull / Legs",
      descricao: "Três treinos diferentes na semana: ideal para dar estímulos intensos e focar na hipertrofia.",
      dias: [dia("A", "Treino A", "Push", ["Peito", "Tríceps", "Ombros"]),
             dia("B", "Treino B", "Pull", ["Costas", "Trapézio", "Bíceps", "Antebraço", "Lombar"]),
             dia("C", "Treino C", "Legs + Core", ["Quadríceps", "Posteriores de coxa", "Glúteos", "Abdômen", "Adutores", "Panturrilha", "Oblíquos"])] },
    { id: "abcde", nome: "ABCDE", subtitulo: "5 dias",
      descricao: "Divisão em 5 dias. No Dia E: foco especial em superiores para homens e inferiores para mulheres.",
      nota: "No app o Treino E depende do sexo do aluno (superiores para homens, inferiores para mulheres). Aqui você escolhe os músculos do Treino E.",
      dias: [dia("A", "Treino A", "Peito + Tríceps", ["Peito", "Tríceps"]),
             dia("B", "Treino B", "Costas + Bíceps", ["Costas", "Bíceps", "Antebraço"]),
             dia("C", "Treino C", "Pernas", ["Quadríceps", "Posteriores de coxa", "Glúteos", "Adutores", "Panturrilha"]),
             dia("D", "Treino D", "Ombros + Core", ["Ombros", "Trapézio", "Abdômen", "Oblíquos", "Lombar"]),
             dia("E", "Treino E", "Especialização", [])] },
    { id: "legs_everyday", nome: "Legs Everyday", subtitulo: "5 dias seguidos, pernas todo dia",
      descricao: "Para quem tem foco e quer treinar pernas todos os dias.",
      nota: "São 5 dias corridos, com pernas em todos eles (mais um pouco de core e superiores). No app, o primeiro e o último exercício de cada dia são de perna.",
      dias: [dia("A", "Dia 1", "Quadríceps + Adutores", ["Quadríceps", "Adutores"].concat(LE_SUP)),
             dia("B", "Dia 2", "Glúteos + Posteriores", ["Glúteos", "Posteriores de coxa", "Panturrilha"].concat(LE_SUP)),
             dia("C", "Dia 3", "Posteriores + Quadríceps", ["Posteriores de coxa", "Quadríceps"].concat(LE_SUP)),
             dia("D", "Dia 4", "Glúteos + Adutores", ["Glúteos", "Adutores", "Panturrilha"].concat(LE_SUP)),
             dia("E", "Dia 5", "Quadríceps + Glúteos", ["Quadríceps", "Glúteos"].concat(LE_SUP))] }
  ];
  // Treinos salvos antes da D090 com a divisao ABCD (4 dias) continuam abrindo para edicao; ela nao e mais oferecida.
  P.DIVISOES_LEGADO = [
    { id: "abcd", nome: "ABCD", subtitulo: "4 dias", descricao: "", legado: true,
      dias: [dia("A", "Treino A", "", []), dia("B", "Treino B", "", []), dia("C", "Treino C", "", []), dia("D", "Treino D", "", [])] }
  ];
  P.MAX_NOME = 80;
  P.MAX_EXERCICIOS_POR_DIA = 12;
  P.PADRAO = { series: 3, repeticoes: 10, descanso: 60 };
  var LEGADO_NOME_PARA_ID = { "upper_lower": "ab", "AB": "ab", "ABC": "abc", "ABCD": "abcd", "ABCDE": "abcde" };

  // Aceita o id ("abc", "legs_everyday"...) ou o nome antigo ("ABC").
  P.divisaoPorId = function (id) {
    var todas = P.DIVISOES.concat(P.DIVISOES_LEGADO);
    var alvo = LEGADO_NOME_PARA_ID[id] || id;
    for (var i = 0; i < todas.length; i++) { if (todas[i].id === alvo) { return todas[i]; } }
    return null;
  };

  function letrasDe(d) { return d.dias.map(function (x) { return x.letra; }); }
  function mesmasLetras(a, b) { return a.length === b.length && a.every(function (l) { return b.indexOf(l) !== -1; }); }

  // Codigos de dia gravados (["A","B","C"...]) -> divisao. `dica` = id gravado nos itens (`divisao`), quando houver.
  // Sem dica, A,B,C e A..E sao ambiguos (ABC x Full Body, ABCDE x Legs x Full Body): vale a divisao de dias fixos mais
  // antiga (AB, ABC, ABCDE, ABCD); 6 ou 7 dias so podem ser Full Body.
  P.divisaoPorLetras = function (letras, dica) {
    var d = dica ? P.divisaoPorId(dica) : null;
    if (d) {
      if (d.variavel) { if (letras.length >= d.min && letras.length <= d.max && letras.join("") === P.LETRAS.slice(0, letras.length).join("")) { return d; } }
      else if (mesmasLetras(letrasDe(d), letras)) { return d; }
    }
    var ordem = ["ab", "abc", "abcde", "abcd", "full_body"];
    for (var i = 0; i < ordem.length; i++) {
      var c = P.divisaoPorId(ordem[i]);
      if (c.variavel) { if (letras.length >= c.min && letras.length <= c.max && letras.join("") === P.LETRAS.slice(0, letras.length).join("")) { return c; } }
      else if (mesmasLetras(letrasDe(c), letras)) { return c; }
    }
    return null;
  };

  P.letrasDaDivisao = function (divisao) {
    var d = P.divisaoPorId(divisao);
    return d ? letrasDe(d) : [];
  };

  // Plano de trabalho do assistente. Os musculos de cada dia ja vem com a sugestao do app (editavel);
  // `semSugestao` deixa os dias vazios (usado ao reabrir um treino salvo).
  // `qtdDias` so vale para divisao variavel (Full Body): de min a max.
  P.novoPlano = function (caminho, divisao, nome, semSugestao, qtdDias) {
    var d = P.divisaoPorId(divisao);
    var plano = {
      caminho: caminho === "fera" ? "fera" : "meu",
      divisao: d ? d.id : null,
      nome: nome || "",
      dias: []
    };
    if (!d) { return plano; }
    var base = d.dias.slice();
    if (d.variavel) {
      var n = Math.max(d.min, Math.min(d.max, parseInt(qtdDias, 10) || d.min));
      while (base.length < n) { var l = P.LETRAS[base.length]; base.push(dia(l, "Treino " + l, base[0].foco, base[0].grupos.slice())); }
      plano.minDias = d.min; plano.maxDias = d.max;
    }
    plano.dias = base.map(function (x) {
      return { letra: x.letra, rotulo: x.rotulo, foco: x.foco, grupos: semSugestao ? [] : x.grupos.slice(), exercicios: [] };
    });
    return plano;
  };

  // Full Body: + Adicionar dia (ate 7) e remover o ultimo (ate 3). Devolve true se mudou.
  P.podeAdicionarDia = function (plano) { var d = P.divisaoPorId(plano && plano.divisao); return !!(d && d.variavel && plano.dias.length < d.max); };
  P.podeRemoverDia = function (plano) { var d = P.divisaoPorId(plano && plano.divisao); return !!(d && d.variavel && plano.dias.length > d.min); };
  P.adicionarDia = function (plano) {
    if (!P.podeAdicionarDia(plano)) { return false; }
    var l = P.LETRAS[plano.dias.length]; var d = P.divisaoPorId(plano.divisao);
    plano.dias.push({ letra: l, rotulo: "Treino " + l, foco: d.dias[0].foco, grupos: d.dias[0].grupos.slice(), exercicios: [] });
    return true;
  };
  P.removerUltimoDia = function (plano) {
    if (!P.podeRemoverDia(plano)) { return false; }
    plano.dias.pop(); return true;
  };

  // Passo 1 -> pode seguir?
  P.validarPasso1 = function (plano) {
    if (!plano || !plano.divisao) { return "Escolha a divisão do treino."; }
    var nome = (plano.nome || "").trim();
    if (!nome) { return "Dê um nome ao treino base."; }
    if (nome.length > P.MAX_NOME) { return "O nome pode ter até " + P.MAX_NOME + " letras."; }
    return null;
  };

  // Passo 2 -> cada dia precisa de ao menos 1 musculo.
  P.validarPasso2 = function (plano) {
    for (var i = 0; i < plano.dias.length; i++) {
      if (!plano.dias[i].grupos.length) { return "Escolha ao menos um músculo em " + plano.dias[i].rotulo + "."; }
    }
    return null;
  };

  // Passo 3 -> cada dia precisa de ao menos 1 exercicio.
  P.validarPasso3 = function (plano) {
    var dv = P.divisaoPorId(plano && plano.divisao);
    if (dv && dv.variavel && plano.dias.length < dv.min) { return "O " + dv.nome + " precisa de pelo menos " + dv.min + " treinos."; }
    for (var i = 0; i < plano.dias.length; i++) {
      if (!plano.dias[i].exercicios.length) { return "Escolha ao menos um exercício em " + plano.dias[i].rotulo + "."; }
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
  // D090: na ordem dos musculos do dia (a do app: ex. Legs Everyday comeca pelas pernas); dentro do musculo, a ordem do catalogo.
  P.catalogoDoDia = function (catalogo, dia) {
    var lista = (catalogo || []).map(function (ex, i) { return { ex: ex, i: i }; }).filter(function (x) { return dia.grupos.indexOf(x.ex.grupo) !== -1; });
    lista.sort(function (a, b) { return (dia.grupos.indexOf(a.ex.grupo) - dia.grupos.indexOf(b.ex.grupo)) || (a.i - b.i); });
    return lista.map(function (x) { return x.ex; });
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
        lista.push({ grupo: e.grupo, subgrupo: e.subgrupo, src: e.src, series: e.series, repeticoes: e.repeticoes, descanso: e.descanso, dia: d.letra, divisao: plano.divisao });
      });
    });
    return lista;
  };

  // Lista gravada -> plano (para editar). Lista sem `dia` em algum item = treino antigo (editor simples).
  P.ehTreinoComDias = function (lista) {
    return Array.isArray(lista) && lista.length > 0 && lista.every(function (e) { return typeof e.dia === "string" && /^[A-G]$/.test(e.dia); });
  };

  // D092 -- contrato unico da divisao com o app. Ordem de leitura:
  // treino_config.divisao -> `divisao` do primeiro item que tiver -> letras dos dias.
  P.divisaoGravada = function (config, lista) {
    if (config && typeof config === "object" && typeof config.divisao === "string" && P.divisaoPorId(config.divisao)) { return P.divisaoPorId(config.divisao).id; }
    var itens = Array.isArray(lista) ? lista : [];
    for (var i = 0; i < itens.length; i++) {
      if (itens[i] && typeof itens[i].divisao === "string" && P.divisaoPorId(itens[i].divisao)) { return P.divisaoPorId(itens[i].divisao).id; }
    }
    return null;
  };

  P.listaParaPlano = function (nome, lista, config) {
    if (!P.ehTreinoComDias(lista)) { return null; }
    var letras = [];
    lista.forEach(function (e) { if (letras.indexOf(e.dia) === -1) { letras.push(e.dia); } });
    letras.sort();
    var dica = P.divisaoGravada(config, lista);
    var div = P.divisaoPorLetras(letras, dica);
    if (!div) { return null; }
    var plano = P.novoPlano("meu", div.id, nome, true, letras.length);
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
    var div = P.divisaoPorLetras(letras, resposta.divisao);
    if (!div || (!div.variavel && div.dias.map(function (x) { return x.letra; }).join() !== letras.join())) { return null; }
    var plano = P.novoPlano("fera", div.id, nome, true, letras.length);
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
