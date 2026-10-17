// =============================================================
// Fera Fit -- logica PURA do painel do personal (D083, 2026-10-17)
//
// Lista simples A-Z com busca e filtros, palavra de situacao por aluno,
// regra de pagamento manual, mensagens do WhatsApp e conta do limite do
// plano Gratis. Sem DOM e sem rede: o parceiro.html so desenha.
//
// Decisoes de Murilo (17/10, mockup v4): uma palavra de situacao por aluno,
// sem icones; Pausado sai do limite do plano Gratis e reativar sem vaga e
// bloqueado; pagamento e CONTROLE MANUAL do personal (o Fera Fit nao
// processa pagamento).
//
// DADOS REAIS (migration 053, em producao) -- o BANCO decide a situacao:
//   pagamentos_das_minhas_fichas -> situacao 'pago' | 'a_vencer' | 'atrasado'
//   frequencia_dos_meus_alunos   -> faltou_2_treinos (definicao provisoria P108)
// SEM FONTE NO BANCO (ganchos, nada inventado como dado):
//   pausado_em  -> Pausado        (nao existe no banco; demanda propria)
//   "Nao entrou no app": so o que ja se sabe (ficha sem aluno_user_id)
// Enquanto o campo nao vier, o filtro correspondente fica vazio e a tela
// diz que ainda nao ha dado -- nunca mostra um numero falso.
// =============================================================
(function (global) {
  "use strict";

  var P = {};
  var DIA = 86400000;

  P.FILTROS = [
    { id: "todos", rotulo: "Todos" },
    { id: "faltou2", rotulo: "Faltou 2 treinos" },
    { id: "atrasado", rotulo: "Pagamento atrasado" },
    { id: "pausados", rotulo: "Pausados" },
    { id: "nao_entrou", rotulo: "Não entrou no app" }
  ];

  function semAcento(s) {
    var t = String(s == null ? "" : s);
    try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* navegador antigo */ }
    return t.toLowerCase();
  }
  P.semAcento = semAcento;

  function primeiroNome(nome) {
    var t = String(nome == null ? "" : nome).trim().split(/\s+/)[0] || "";
    return t;
  }
  P.primeiroNome = primeiroNome;

  // ---------- mensagens do WhatsApp (aprovadas por Murilo) ----------
  P.mensagemCobranca = function (nome) {
    var n = primeiroNome(nome);
    return (n ? "Oi, " + n + "!" : "Oi!") + " Passando para lembrar do pagamento deste mês.";
  };
  P.mensagemFaltas = function (nome) {
    var n = primeiroNome(nome);
    return (n ? "Oi, " + n + "!" : "Oi!") + " Senti sua falta nos últimos treinos. Está tudo bem? Quer ajustar o treino?";
  };

  // Telefone brasileiro -> numero internacional so com digitos, ou null.
  P.numeroWhatsapp = function (telefone) {
    var d = String(telefone == null ? "" : telefone).replace(/\D+/g, "");
    if (d.length === 10 || d.length === 11) { return "55" + d; }
    if ((d.length === 12 || d.length === 13) && d.indexOf("55") === 0) { return d; }
    return null;
  };
  P.linkWhatsapp = function (telefone, texto) {
    var n = P.numeroWhatsapp(telefone);
    if (!n) { return null; }
    return "https://wa.me/" + n + (texto ? "?text=" + encodeURIComponent(texto) : "");
  };

  // ---------- dinheiro ----------
  P.formatarValor = function (centavos) {
    var c = Number(centavos);
    if (!isFinite(c) || c < 0) { return ""; }
    var reais = c / 100;
    if (Math.round(c) % 100 === 0) { return "R$ " + String(Math.round(reais)); }
    return "R$ " + reais.toFixed(2).replace(".", ",");
  };
  // "150" / "150,50" / "R$ 1.500,00" -> centavos inteiros, ou null.
  P.valorParaCentavos = function (texto) {
    var t = String(texto == null ? "" : texto).replace(/R\$/i, "").replace(/\s+/g, "");
    if (!t) { return null; }
    if (t.indexOf(",") !== -1) { t = t.replace(/\./g, "").replace(",", "."); }
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) { t = t.replace(/\./g, ""); }
    if (!/^\d+(\.\d{1,2})?$/.test(t)) { return null; }
    var c = Math.round(parseFloat(t) * 100);
    return c > 0 && c <= 100000000 ? c : null;
  };

  // ---------- pagamento manual ----------
  function utc(a, m, d) { return Date.UTC(a, m, d); }
  function ultimoDiaDoMes(a, m) { return new Date(Date.UTC(a, m + 1, 0)).getUTCDate(); }
  function vencimentoDoMes(a, m, dia) {
    var base = new Date(Date.UTC(a, m, 1));
    return utc(base.getUTCFullYear(), base.getUTCMonth(), Math.min(dia, ultimoDiaDoMes(base.getUTCFullYear(), base.getUTCMonth())));
  }
  function dataTexto(t) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t == null ? "" : t));
    return m ? utc(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function hojeUtc(hoje) {
    var h = hoje instanceof Date ? hoje : new Date();
    return utc(h.getFullYear(), h.getMonth(), h.getDate());
  }
  function diaDoMes(t) { return new Date(t).getUTCDate(); }

  // pg = linha de pagamentos_das_minhas_fichas ja normalizada pelo PagamentosStore:
  //   { valor_centavos, dia_vencimento, vencimento_atual 'AAAA-MM-DD', pago_mes_atual,
  //     meses_em_atraso, situacao 'pago'|'a_vencer'|'atrasado' }.
  // A SITUACAO vem do banco (fuso de Sao Paulo); aqui so se calcula o texto.
  //   atrasado -> { tipo:'atrasado', meses, dias }  (dias so quando e 1 mes e o vencimento
  //               deste mes ja passou sem pago; senao dias = null e o texto diz o mes)
  //   a_vencer -> vence_hoje / vence_em (ate 7 dias) / em_dia
  //   pago     -> em_dia
  P.statusPagamento = function (pg, hoje) {
    if (!pg || (pg.situacao !== "pago" && pg.situacao !== "a_vencer" && pg.situacao !== "atrasado")) { return null; }
    var h = hojeUtc(hoje);
    var venc = dataTexto(pg.vencimento_atual);
    if (pg.situacao === "atrasado") {
      var meses = Math.max(1, Number(pg.meses_em_atraso) || 1);
      var dias = null;
      if (meses === 1 && pg.pago_mes_atual !== true && venc !== null && venc < h) { dias = Math.round((h - venc) / DIA); }
      return { tipo: "atrasado", meses: meses, dias: dias, vencimento: venc };
    }
    if (pg.situacao === "a_vencer") {
      var falta = venc === null ? null : Math.round((venc - h) / DIA);
      if (falta === null) { return { tipo: "em_dia", dias: null, vencimento: venc }; }
      if (falta <= 0) { return { tipo: "vence_hoje", dias: 0, vencimento: venc }; }
      return { tipo: falta <= 7 ? "vence_em" : "em_dia", dias: falta, vencimento: venc };
    }
    return { tipo: "em_dia", dias: null, vencimento: venc };
  };

  P.textoStatusPagamento = function (s) {
    if (!s) { return "Sem cobrança"; }
    if (s.tipo === "atrasado") {
      if (s.dias !== null && s.dias !== undefined) { return "Atrasado " + s.dias + (s.dias === 1 ? " dia" : " dias"); }
      return "Atrasado " + s.meses + (s.meses === 1 ? " mês" : " meses");
    }
    if (s.tipo === "vence_hoje") { return "Vence hoje"; }
    if (s.tipo === "vence_em") { return s.dias === 0 ? "Vence hoje" : "Vence em " + s.dias + (s.dias === 1 ? " dia" : " dias"); }
    return "Em dia";
  };

  // Linha pequena da tela Pagamentos: "R$ 150 · venceu dia 10" / "vence dia 20".
  P.detalhePagamento = function (pg, s) {
    if (!pg) { return ""; }
    var v = P.formatarValor(pg.valor_centavos);
    var partes = [];
    if (v) { partes.push(v); }
    if (s) {
      var dv = s.vencimento === null || s.vencimento === undefined ? null : diaDoMes(s.vencimento);
      if (s.tipo === "atrasado") { partes.push(s.dias === null || s.dias === undefined || dv === null ? "vencimento todo dia " + pg.dia_vencimento : "venceu dia " + dv); }
      else if (s.tipo === "vence_hoje") { partes.push("vence hoje"); }
      else { partes.push("vence dia " + (dv === null ? pg.dia_vencimento : dv)); }
    }
    return partes.join(" · ");
  };

  // Meses vencidos e sem marca de pago, dos ultimos 12 meses (o banco devolve os 12 ultimos
  // meses pagos), do mais antigo para o mais novo: ['AAAA-MM-01', ...].
  P.mesesPendentes = function (pg, hoje) {
    if (!pg || !pg.competencia_atual) { return []; }
    var h = hojeUtc(hoje);
    var ini = dataTexto(pg.inicio_em);
    var atual = dataTexto(pg.competencia_atual);
    if (atual === null) { return []; }
    var pagos = {};
    (pg.ultimos_meses_pagos || []).forEach(function (m) { pagos[String(m).slice(0, 7)] = true; });
    if (pg.pago_mes_atual === true) { pagos[String(pg.competencia_atual).slice(0, 7)] = true; }
    var dia = Number(pg.dia_vencimento);
    var ad = new Date(atual);
    var out = [];
    for (var i = 11; i >= 0; i--) {
      var a = ad.getUTCFullYear(), m = ad.getUTCMonth() - i;
      var t = utc(a, m, 1);
      if (ini !== null && t < ini) { continue; }
      var d = new Date(t);
      var chave = d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2);
      if (vencimentoDoMes(d.getUTCFullYear(), d.getUTCMonth(), dia) < h && !pagos[chave]) { out.push(chave + "-01"); }
    }
    return out;
  };
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  P.rotuloMes = function (competencia) {
    var t = dataTexto(competencia);
    if (t === null) { return ""; }
    var d = new Date(t);
    return MESES[d.getUTCMonth()] + "/" + d.getUTCFullYear();
  };

  // ---------- lista ----------
  // manuais: fichas ({id,nome,telefone,aluno_user_id,pausado_em?}); vinculados: vw_aluno_para_parceiro
  // ({user_id,nome,pausado_em?,faltou_2_treinos?}); pagamentos: mapa por chave ou null.
  P.chaveFicha = function (id) { return "f:" + id; };
  P.chaveApp = function (userId) { return "a:" + userId; };

  P.montarLinhas = function (manuais, vinculados, pagamentos, frequencia) {
    var porUser = {};
    var linhas = [];
    (vinculados || []).forEach(function (v) {
      var l = {
        chave: P.chaveApp(v.user_id), tipo: "app", fichaId: null, userId: v.user_id,
        nome: v.nome || "", telefone: null, entrouNoApp: true,
        pausado: v.pausado_em !== undefined ? !!v.pausado_em : undefined,
        faltou2: v.faltou_2_treinos !== undefined ? v.faltou_2_treinos === true : undefined
      };
      porUser[v.user_id] = l;
      linhas.push(l);
    });
    (manuais || []).forEach(function (f) {
      var ja = f.aluno_user_id ? porUser[f.aluno_user_id] : null;
      if (ja) { // a ficha e o vinculo sao o mesmo aluno: uma linha so
        ja.fichaId = f.id; ja.telefone = f.telefone || null;
        if (f.nome) { ja.nome = f.nome; }
        if (f.pausado_em !== undefined) { ja.pausado = !!f.pausado_em; }
        return;
      }
      linhas.push({
        chave: P.chaveFicha(f.id), tipo: f.aluno_user_id ? "app" : "manual", fichaId: f.id, userId: f.aluno_user_id || null,
        nome: f.nome || "", telefone: f.telefone || null, entrouNoApp: !!f.aluno_user_id,
        pausado: f.pausado_em !== undefined ? !!f.pausado_em : undefined, faltou2: undefined
      });
    });
    linhas.forEach(function (l) {
      var pg = null;
      if (pagamentos) {
        pg = (l.fichaId != null && pagamentos[P.chaveFicha(l.fichaId)]) || null; // controle e por FICHA (053)
      }
      l.pagamento = pg;
      // frequencia: so aluno do app com vinculo ativo (RPC 053); sem linha = sem dado
      var fq = frequencia && l.fichaId != null ? frequencia[P.chaveFicha(l.fichaId)] : null;
      if (fq) { l.faltou2 = fq.faltou_2_treinos === true; }
    });
    return linhas;
  };

  P.ordenarAZ = function (linhas) {
    return linhas.slice().sort(function (a, b) {
      var c = String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" });
      return c !== 0 ? c : String(a.chave).localeCompare(String(b.chave));
    });
  };

  P.situacao = function (linha, hoje) {
    if (linha.pausado === true) { return { chave: "pausado", texto: "Pausado", classe: "" }; }
    var s = P.statusPagamento(linha.pagamento, hoje);
    if (s && (s.tipo === "atrasado")) { return { chave: "atrasado", texto: P.textoStatusPagamento(s), classe: "r" }; }
    if (linha.faltou2 === true) { return { chave: "faltou2", texto: "Faltou 2 treinos", classe: "a" }; }
    if (!linha.entrouNoApp) { return { chave: "nao_entrou", texto: "Não entrou no app", classe: "a" }; }
    if (s) {
      var classe = (s.tipo === "vence_hoje" || s.tipo === "vence_em") ? "a" : "";
      return { chave: s.tipo, texto: P.textoStatusPagamento(s), classe: classe };
    }
    return { chave: "", texto: "", classe: "" };
  };

  function passaFiltro(linha, filtro, hoje) {
    if (filtro === "todos" || !filtro) { return true; }
    if (filtro === "pausados") { return linha.pausado === true; }
    if (filtro === "nao_entrou") { return !linha.entrouNoApp; }
    if (filtro === "faltou2") { return linha.faltou2 === true; }
    if (filtro === "atrasado") {
      var s = P.statusPagamento(linha.pagamento, hoje);
      return !!s && s.tipo === "atrasado";
    }
    return true;
  }

  P.filtrar = function (linhas, opcoes) {
    opcoes = opcoes || {};
    var termo = semAcento(opcoes.busca || "").trim();
    return linhas.filter(function (l) {
      if (termo && semAcento(l.nome).indexOf(termo) === -1) { return false; }
      return passaFiltro(l, opcoes.filtro, opcoes.hoje);
    });
  };

  // O filtro tem de onde tirar dado? (para dizer "ainda sem dados" em vez de "ninguem")
  P.filtroTemDados = function (linhas, filtro) {
    if (filtro === "faltou2") { return linhas.some(function (l) { return l.faltou2 !== undefined; }); }
    if (filtro === "atrasado") { return linhas.some(function (l) { return !!l.pagamento; }); }
    if (filtro === "pausados") { return linhas.some(function (l) { return l.pausado !== undefined; }); }
    return true;
  };

  P.agruparPorLetra = function (linhasOrdenadas) {
    var grupos = [];
    linhasOrdenadas.forEach(function (l) {
      var c = semAcento(l.nome).trim().charAt(0).toUpperCase();
      var letra = /[A-Z]/.test(c) ? c : "#";
      var g = grupos.length ? grupos[grupos.length - 1] : null;
      if (!g || g.letra !== letra) { g = { letra: letra, itens: [] }; grupos.push(g); }
      g.itens.push(l);
    });
    return grupos;
  };

  // ---------- limite do plano (Pausado nao conta) ----------
  P.contarAtivos = function (linhas) {
    return linhas.filter(function (l) { return l.pausado !== true; }).length;
  };
  // limite null/undefined = nao informado (a Backend e quem decide): nao bloqueia aqui.
  P.podeReativar = function (linhas, limite) {
    if (limite === null || limite === undefined) { return true; }
    return P.contarAtivos(linhas) < Number(limite);
  };

  // ---------- tela Pagamentos ----------
  P.contagemPagamentos = function (linhas, hoje) {
    var c = { todos: linhas.length, atrasados: 0, semana: 0, emDia: 0, semCobranca: 0 };
    linhas.forEach(function (l) {
      var s = P.statusPagamento(l.pagamento, hoje);
      if (!s) { c.semCobranca++; }
      else if (s.tipo === "atrasado") { c.atrasados++; }
      else if (s.tipo === "vence_hoje" || s.tipo === "vence_em") { c.semana++; }
      else { c.emDia++; }
    });
    return c;
  };
  P.filtrarPagamentos = function (linhas, filtro, hoje) {
    return linhas.filter(function (l) {
      if (!filtro || filtro === "todos") { return true; }
      var s = P.statusPagamento(l.pagamento, hoje);
      if (filtro === "atrasados") { return !!s && s.tipo === "atrasado"; }
      if (filtro === "semana") { return !!s && (s.tipo === "vence_hoje" || s.tipo === "vence_em"); }
      if (filtro === "em_dia") { return !!s && s.tipo === "em_dia"; }
      return true;
    });
  };

  global.PainelAlunos = P;
  if (typeof module !== "undefined" && module.exports) { module.exports = P; }
})(typeof window !== "undefined" ? window : globalThis);
