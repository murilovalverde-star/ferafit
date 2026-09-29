// =============================================================
// Fera Fit — Camada de dados de PARCEIROS (cadastro, aprovação,
// perfil e cobrança de academias e personais)
//
// D036 do Orquestrador (2026-09-29): "camada de dados trocável —
// demonstração hoje, Supabase depois". Este arquivo separa uma
// interface única (as funções que as telas chamam) com duas
// implementações: `ParceirosStoreDemo` (tudo em localStorage, ativa
// hoje) e `ParceirosStoreSupabase` (vazia, à espera da migration 019/
// 020 da Backend — D082/D084/D087). Trocar de demo para Supabase é
// trocar só a linha `global.ParceirosStore = ParceirosStoreDemo;` no
// fim deste arquivo — nenhuma tela (admin.html, parceiro.html) muda.
//
// Nenhuma linha deste arquivo chama tabela nova do Supabase nem usa
// chave além da `publishable` — é 100% local, igual ao resto da
// camada de demonstração do site.
//
// Nomes de campo e de regra seguem os dois specs da Backend (lidos só
// para uso como guia, nenhuma tabela real é tocada):
//   - SPEC_admin_parceiros_001.md — aprovação, perfil (nunca dado de
//     aluno), cobrança manual append-only, faixas, suspender/reativar.
//   - SPEC_parceiro_auth_e_fotos_001.md — cadastro com aprovação para
//     os dois tipos, senha escolhida pelo personal no próprio cadastro,
//     foto de perfil + galeria de até 6 fotos para os dois.
//
// Propositalmente separado de `dados-demo.js` (que cuida de aluno/
// treino) — são domínios diferentes: quem É parceiro (este arquivo)
// vs. o que o parceiro FAZ com os próprios alunos (dados-demo.js).
//
// Faixas comerciais (30/50/100/+100 alunos, preço indefinido) seguem
// o texto literal da D036 — nota para o Orquestrador registrada no
// STATUS.md: são diferentes da faixa técnica `cota_faixas` (5/10/20/
// 50/100/+100) já em produção; a `SPEC_admin_parceiros_001.md` (seção
// 1.2) deixou essa divergência como pergunta em aberto para Murilo, e
// a D036 parece resolvê-la, mas quem precisa fechar isso de vez na
// migration real é a Backend, não esta camada de demonstração.
//
// Senha do personal (cadastro, D036/P69): esta camada NUNCA guarda o
// texto da senha digitada — só a existência dela (`senhaDefinida`).
// Não há autenticação real aqui (isso é Supabase Auth, fora do escopo
// desta IA — ver P24 do STATUS.md), então guardar o texto da senha
// não serviria a nada, e evita ficar com uma credencial em texto puro
// dentro do localStorage mesmo sendo só demonstração.
//
// Fotos e galeria: sem Supabase Storage real ainda, esta camada não
// guarda os bytes da imagem (evita inchar o localStorage) — só nome e
// tamanho de cada arquivo escolhido, suficiente para a tela mostrar
// "3 de 6 fotos enviadas" etc. Pré-visualização na tela usa
// `URL.createObjectURL` (só na memória do navegador, nunca gravado).
// =============================================================

(function (global) {
  "use strict";

  var CHAVE_LOCALSTORAGE = "ferafit_parceiros_v1";
  var MAX_FOTOS_GALERIA = 6;

  // Faixas comerciais da D036 — preço NULL até Murilo definir; nunca
  // fixo em código (mesma regra da SPEC_admin_parceiros_001.md, seção
  // 2.1: qualquer ajuste de preço é dado, nunca migration nova).
  var FAIXAS_PADRAO = [
    { id: "ate_30", rotulo: "Até 30 alunos", limiteAlunos: 30, precoMensal: null, precoExcedentePorAluno: null },
    { id: "ate_50", rotulo: "Até 50 alunos", limiteAlunos: 50, precoMensal: null, precoExcedentePorAluno: null },
    { id: "ate_100", rotulo: "Até 100 alunos", limiteAlunos: 100, precoMensal: null, precoExcedentePorAluno: null },
    { id: "mais_100", rotulo: "Mais de 100 alunos", limiteAlunos: null, precoMensal: null, precoExcedentePorAluno: null }
  ];

  function estadoPadrao() {
    return {
      versao: 1,
      academias: [],
      personais: [],
      // Append-only — espelha `parceiro_cobrancas` (SPEC_admin, 2.2).
      // Uma correção é sempre uma linha nova, nunca UPDATE/DELETE.
      cobrancas: [],
      // Append-only — espelha `parceiro_acoes_admin` (SPEC_admin, 2.3).
      acoesAdmin: [],
      faixas: FAIXAS_PADRAO.map(function (f) {
        return { id: f.id, rotulo: f.rotulo, limiteAlunos: f.limiteAlunos, precoMensal: f.precoMensal, precoExcedentePorAluno: f.precoExcedentePorAluno };
      })
    };
  }

  function carregarEstado() {
    var bruto;
    try {
      bruto = localStorage.getItem(CHAVE_LOCALSTORAGE);
    } catch (e) {
      return estadoPadrao();
    }
    if (!bruto) {
      return estadoPadrao();
    }
    try {
      var estado = JSON.parse(bruto);
      if (!estado || estado.versao !== 1) {
        return estadoPadrao();
      }
      if (!estado.academias) estado.academias = [];
      if (!estado.personais) estado.personais = [];
      if (!estado.cobrancas) estado.cobrancas = [];
      if (!estado.acoesAdmin) estado.acoesAdmin = [];
      if (!estado.faixas || !estado.faixas.length) estado.faixas = estadoPadrao().faixas;
      return estado;
    } catch (e) {
      return estadoPadrao();
    }
  }

  function salvarEstado(estado) {
    try {
      localStorage.setItem(CHAVE_LOCALSTORAGE, JSON.stringify(estado));
    } catch (e) {
      // Sem storage disponível — a sessão de teste atual continua
      // funcionando em memória, só não sobrevive a um recarregamento.
    }
  }

  function gerarId(prefixo) {
    return prefixo + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function hojeISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function diasEntre(isoAntiga, isoNova) {
    var a = new Date(isoAntiga + "T00:00:00");
    var b = new Date(isoNova + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  function listaPorTipo(estado, tipo) {
    if (tipo !== "academia" && tipo !== "personal") {
      throw new Error("Tipo de parceiro inválido: " + tipo + " (use 'academia' ou 'personal').");
    }
    return tipo === "academia" ? estado.academias : estado.personais;
  }

  function encontrarParceiro(estado, tipo, id) {
    var lista = listaPorTipo(estado, tipo);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        return lista[i];
      }
    }
    return null;
  }

  function exigirParceiro(estado, tipo, id) {
    var p = encontrarParceiro(estado, tipo, id);
    if (!p) {
      throw new Error("Parceiro não encontrado: " + tipo + "/" + id);
    }
    return p;
  }

  function normalizarArquivos(lista, max) {
    var arr = (lista || []).slice(0, max || MAX_FOTOS_GALERIA);
    return arr.map(function (f) {
      return { nomeArquivo: (f && f.name) || "arquivo", tamanhoKB: f && f.size ? Math.round(f.size / 1024) : null };
    });
  }

  // ===========================================================
  // IMPLEMENTAÇÃO DE DEMONSTRAÇÃO — tudo em localStorage do navegador
  // ===========================================================
  var ParceirosStoreDemo = {};

  // --- Cadastro (SPEC_parceiro_auth_e_fotos_001.md, seções 2.1/2.2) ---

  ParceirosStoreDemo.cadastrarAcademia = function (dados) {
    dados = dados || {};
    var estado = carregarEstado();
    var registro = {
      id: gerarId("academia"),
      tipo: "academia",
      criadoEm: Date.now(),
      // Nasce inativa — passa por aprovação, igual ao personal (P68/D083).
      ativa: false,
      nome: (dados.nome || "").trim(),
      cnpj: (dados.cnpj || "").trim(),
      endereco: (dados.endereco || "").trim(),
      cidade: (dados.cidade || "").trim(),
      responsavel: (dados.responsavel || "").trim(),
      telefone: (dados.telefone || "").trim(),
      email: (dados.email || "").trim(),
      fotoPerfil: dados.fotoPerfil ? normalizarArquivos([dados.fotoPerfil], 1)[0] : null,
      galeria: normalizarArquivos(dados.galeria, MAX_FOTOS_GALERIA),
      faixaId: null,
      limiteAlunos: null,
      desativadoEm: null
    };
    estado.academias.push(registro);
    salvarEstado(estado);
    return registro;
  };

  ParceirosStoreDemo.cadastrarPersonal = function (dados) {
    dados = dados || {};
    var estado = carregarEstado();
    var registro = {
      id: gerarId("personal"),
      tipo: "personal",
      criadoEm: Date.now(),
      // Nasce inativo — passa por aprovação (P69/D083: senha já escolhida
      // no cadastro, mas o painel só libera depois de aprovado).
      ativo: false,
      nome: (dados.nome || "").trim(),
      cref: (dados.cref || "").trim(),
      formacao: (dados.formacao || "").trim(),
      especializacao: (dados.especializacao || "").trim(),
      cidade: (dados.cidade || "").trim(),
      bairro: (dados.bairro || "").trim(),
      experiencias: (dados.experiencias || "").trim(),
      telefone: (dados.telefone || "").trim(),
      email: (dados.email || "").trim(),
      // Nunca guarda o texto da senha — ver nota no cabeçalho do arquivo.
      senhaDefinida: !!(dados.senha && dados.senha.length),
      fotoPerfil: dados.fotoPerfil ? normalizarArquivos([dados.fotoPerfil], 1)[0] : null,
      galeria: normalizarArquivos(dados.galeria, MAX_FOTOS_GALERIA),
      faixaId: null,
      limiteAlunos: null,
      desativadoEm: null
    };
    estado.personais.push(registro);
    salvarEstado(estado);
    return registro;
  };

  // --- Fila de aprovação e listagens (SPEC_admin, seção 1, item 2) ---

  ParceirosStoreDemo.listarPendentes = function () {
    var estado = carregarEstado();
    var pendentes = estado.academias.filter(function (a) { return !a.ativa; })
      .concat(estado.personais.filter(function (p) { return !p.ativo; }));
    return pendentes.sort(function (a, b) { return a.criadoEm - b.criadoEm; });
  };

  ParceirosStoreDemo.listarAtivos = function () {
    var estado = carregarEstado();
    var ativos = estado.academias.filter(function (a) { return a.ativa; })
      .concat(estado.personais.filter(function (p) { return p.ativo; }));
    return ativos.sort(function (a, b) { return a.criadoEm - b.criadoEm; });
  };

  ParceirosStoreDemo.listarTodos = function () {
    var estado = carregarEstado();
    return estado.academias.concat(estado.personais).sort(function (a, b) { return b.criadoEm - a.criadoEm; });
  };

  // --- Perfil — nunca dado sensível de aluno (SPEC_admin, seção 3.3) ---
  // Só contagem/faixa, igual à função admin_perfil_parceiro da spec:
  // nunca faz join com medidas, avaliações nem treino do aluno.

  ParceirosStoreDemo.perfilParceiro = function (tipo, id) {
    var estado = carregarEstado();
    var p = exigirParceiro(estado, tipo, id);
    return {
      id: p.id,
      tipo: p.tipo,
      nome: p.nome,
      ativo: tipo === "academia" ? p.ativa : p.ativo,
      faixaId: p.faixaId,
      limiteAlunos: p.limiteAlunos,
      // Contagem real de alunos vinculados vem do banco (vínculo
      // aluno-parceiro ainda não existe nesta camada de demonstração,
      // que só cuida do cadastro do próprio parceiro) — 0 por enquanto.
      alunosAtivos: 0,
      criadoEm: p.criadoEm
    };
  };

  // --- Aprovar / recusar / suspender / reativar (SPEC_admin, 3.4) ---
  // Cada ação também grava uma linha de auditoria, igual à spec.

  function registrarAcaoAdmin(estado, tipo, id, acao, motivo) {
    estado.acoesAdmin.push({
      id: gerarId("acao"),
      tipo: tipo,
      parceiroId: id,
      acao: acao,
      motivo: (motivo || "").trim() || null,
      criadoEm: Date.now()
    });
  }

  ParceirosStoreDemo.aprovarParceiro = function (tipo, id) {
    var estado = carregarEstado();
    var p = exigirParceiro(estado, tipo, id);
    if (tipo === "academia") { p.ativa = true; } else { p.ativo = true; }
    p.desativadoEm = null;
    registrarAcaoAdmin(estado, tipo, id, "aprovado", null);
    salvarEstado(estado);
    return p;
  };

  ParceirosStoreDemo.recusarParceiro = function (tipo, id, motivo) {
    var estado = carregarEstado();
    var p = exigirParceiro(estado, tipo, id);
    // Recusa não reverte nenhum campo — ativo/ativa nunca chegaram a
    // ser true (mesma nota da SPEC_admin, seção 3.4).
    registrarAcaoAdmin(estado, tipo, id, "recusado", motivo);
    salvarEstado(estado);
    return p;
  };

  ParceirosStoreDemo.suspenderParceiro = function (tipo, id, motivo) {
    var estado = carregarEstado();
    var p = exigirParceiro(estado, tipo, id);
    if (tipo === "academia") { p.ativa = false; } else { p.ativo = false; }
    p.desativadoEm = hojeISO();
    registrarAcaoAdmin(estado, tipo, id, "suspenso", motivo);
    salvarEstado(estado);
    return p;
  };

  ParceirosStoreDemo.reativarParceiro = function (tipo, id) {
    var estado = carregarEstado();
    var p = exigirParceiro(estado, tipo, id);
    if (tipo === "academia") { p.ativa = true; } else { p.ativo = true; }
    p.desativadoEm = null;
    registrarAcaoAdmin(estado, tipo, id, "reativado", null);
    salvarEstado(estado);
    return p;
  };

  ParceirosStoreDemo.historicoAcoesAdmin = function (tipo, id) {
    var estado = carregarEstado();
    return estado.acoesAdmin.filter(function (a) { return a.tipo === tipo && a.parceiroId === id; })
      .sort(function (a, b) { return b.criadoEm - a.criadoEm; });
  };

  // --- Cobrança e pagamento — histórico append-only (SPEC_admin, 2.2/3.5) ---
  // Nunca editado nem apagado: uma correção é sempre um registro novo,
  // tipo "ajuste", referenciando o que corrigiu.

  ParceirosStoreDemo.registrarCobranca = function (tipo, id, valor, vencimento, observacao) {
    var estado = carregarEstado();
    exigirParceiro(estado, tipo, id);
    if (!(valor >= 0)) {
      throw new Error("Valor da cobrança precisa ser um número >= 0.");
    }
    var registro = {
      id: gerarId("cobranca"),
      tipo: tipo,
      parceiroId: id,
      tipoEvento: "cobranca",
      valor: valor,
      vencimento: vencimento || null,
      formaPagamento: null,
      observacao: (observacao || "").trim() || null,
      criadoEm: Date.now()
    };
    estado.cobrancas.push(registro);
    salvarEstado(estado);
    return registro;
  };

  ParceirosStoreDemo.registrarPagamento = function (tipo, id, valor, formaPagamento, observacao) {
    var estado = carregarEstado();
    exigirParceiro(estado, tipo, id);
    if (!(valor >= 0)) {
      throw new Error("Valor do pagamento precisa ser um número >= 0.");
    }
    if (["pix", "transferencia", "outro"].indexOf(formaPagamento) === -1) {
      throw new Error("Forma de pagamento precisa ser 'pix', 'transferencia' ou 'outro'.");
    }
    var registro = {
      id: gerarId("pagamento"),
      tipo: tipo,
      parceiroId: id,
      tipoEvento: "pagamento",
      valor: valor,
      vencimento: null,
      formaPagamento: formaPagamento,
      observacao: (observacao || "").trim() || null,
      criadoEm: Date.now()
    };
    estado.cobrancas.push(registro);
    salvarEstado(estado);
    return registro;
  };

  // Correção manual — nunca UPDATE/DELETE de linha antiga (SPEC_admin, 2.2).
  ParceirosStoreDemo.registrarAjuste = function (tipo, id, valor, observacaoObrigatoria) {
    var estado = carregarEstado();
    exigirParceiro(estado, tipo, id);
    if (!observacaoObrigatoria || !observacaoObrigatoria.trim()) {
      throw new Error("Um ajuste precisa dizer o que está corrigindo (observação obrigatória).");
    }
    var registro = {
      id: gerarId("ajuste"),
      tipo: tipo,
      parceiroId: id,
      tipoEvento: "ajuste",
      valor: valor,
      vencimento: null,
      formaPagamento: null,
      observacao: observacaoObrigatoria.trim(),
      criadoEm: Date.now()
    };
    estado.cobrancas.push(registro);
    salvarEstado(estado);
    return registro;
  };

  ParceirosStoreDemo.historicoCobranca = function (tipo, id) {
    var estado = carregarEstado();
    return estado.cobrancas.filter(function (c) { return c.tipo === tipo && c.parceiroId === id; })
      .sort(function (a, b) { return b.criadoEm - a.criadoEm; });
  };

  // "Em dia / vencido há N dias" — calculado na consulta, nunca
  // gravado (SPEC_admin, seção 3.2). Quitação pela cobrança mais
  // antiga primeiro (FIFO) — decisão explícita da D036, resolvendo o
  // ponto que a spec tinha deixado em aberto (seção 6, item 3): cada
  // pagamento (em ordem de registro) quita a cobrança em aberto mais
  // antiga (em ordem de vencimento) que ainda não tinha pagamento.
  ParceirosStoreDemo.statusCobranca = function (tipo, id) {
    var estado = carregarEstado();
    exigirParceiro(estado, tipo, id);
    var eventos = estado.cobrancas.filter(function (c) { return c.tipo === tipo && c.parceiroId === id; });
    var cobrancas = eventos.filter(function (c) { return c.tipoEvento === "cobranca"; })
      .slice().sort(function (a, b) { return (a.vencimento || "") < (b.vencimento || "") ? -1 : 1; });
    var pagamentos = eventos.filter(function (c) { return c.tipoEvento === "pagamento"; })
      .slice().sort(function (a, b) { return a.criadoEm - b.criadoEm; });

    var ultimoVencimento = cobrancas.length ? cobrancas[cobrancas.length - 1].vencimento : null;
    var ultimoPagamentoEm = pagamentos.length ? pagamentos[pagamentos.length - 1].criadoEm : null;

    if (!cobrancas.length) {
      return { ultimoVencimento: null, ultimoPagamentoEm: ultimoPagamentoEm, diasEmAtraso: 0, rotulo: "sem cobrança registrada" };
    }

    // FIFO: o pagamento nº (i+1), em ordem de registro, quita a
    // cobrança nº (i+1), em ordem de vencimento.
    var quitadas = pagamentos.length;
    if (quitadas >= cobrancas.length) {
      return { ultimoVencimento: ultimoVencimento, ultimoPagamentoEm: ultimoPagamentoEm, diasEmAtraso: 0, rotulo: "em dia" };
    }

    var cobrancaEmAberto = cobrancas[quitadas]; // a mais antiga ainda não quitada
    var hoje = hojeISO();
    var dias = cobrancaEmAberto.vencimento ? diasEntre(cobrancaEmAberto.vencimento, hoje) : 0;
    var diasEmAtraso = Math.max(0, dias);
    return {
      ultimoVencimento: ultimoVencimento,
      ultimoPagamentoEm: ultimoPagamentoEm,
      diasEmAtraso: diasEmAtraso,
      rotulo: diasEmAtraso > 0 ? ("vencido há " + diasEmAtraso + " dia" + (diasEmAtraso === 1 ? "" : "s")) : "em dia"
    };
  };

  // --- Faixas comerciais (SPEC_admin, seções 1.2/2.1) ---

  ParceirosStoreDemo.listarFaixas = function () {
    var estado = carregarEstado();
    return estado.faixas.slice();
  };

  ParceirosStoreDemo.definirPrecoFaixa = function (faixaId, precoMensal, precoExcedentePorAluno) {
    var estado = carregarEstado();
    var faixa = null;
    for (var i = 0; i < estado.faixas.length; i++) {
      if (estado.faixas[i].id === faixaId) { faixa = estado.faixas[i]; break; }
    }
    if (!faixa) {
      throw new Error("Faixa não encontrada: " + faixaId);
    }
    faixa.precoMensal = (precoMensal === null || precoMensal === "" || precoMensal === undefined) ? null : Number(precoMensal);
    faixa.precoExcedentePorAluno = (precoExcedentePorAluno === null || precoExcedentePorAluno === "" || precoExcedentePorAluno === undefined) ? null : Number(precoExcedentePorAluno);
    salvarEstado(estado);
    return faixa;
  };

  ParceirosStoreDemo.definirFaixaParceiro = function (tipo, id, faixaId) {
    var estado = carregarEstado();
    var p = exigirParceiro(estado, tipo, id);
    var faixa = null;
    for (var i = 0; i < estado.faixas.length; i++) {
      if (estado.faixas[i].id === faixaId) { faixa = estado.faixas[i]; break; }
    }
    if (!faixa) {
      throw new Error("Faixa não encontrada: " + faixaId);
    }
    p.faixaId = faixaId;
    p.limiteAlunos = faixa.limiteAlunos;
    salvarEstado(estado);
    return p;
  };

  // ===========================================================
  // IMPLEMENTAÇÃO SUPABASE — vazia, à espera da migration 019/020 da
  // Backend (D082/D084/D087). Mesma lista de funções da demo, cada
  // uma reservada para virar uma chamada real (`supabase.rpc(...)`,
  // sempre client anon/publishable, nunca service_role).
  // ===========================================================
  var ParceirosStoreSupabase = {};
  [
    "cadastrarAcademia", "cadastrarPersonal", "listarPendentes", "listarAtivos", "listarTodos",
    "perfilParceiro", "aprovarParceiro", "recusarParceiro", "suspenderParceiro", "reativarParceiro",
    "historicoAcoesAdmin", "registrarCobranca", "registrarPagamento", "registrarAjuste",
    "historicoCobranca", "statusCobranca", "listarFaixas", "definirPrecoFaixa", "definirFaixaParceiro"
  ].forEach(function (nomeFuncao) {
    ParceirosStoreSupabase[nomeFuncao] = function () {
      throw new Error("ParceirosStore (Supabase): '" + nomeFuncao + "' ainda não implementada — aguarda o banco real (D087 da Backend, migration 019/020).");
    };
  });

  // Troca aqui quando o banco chegar — nenhuma tela precisa mudar.
  global.ParceirosStore = ParceirosStoreDemo;
  global.ParceirosStoreDemo = ParceirosStoreDemo;
  global.ParceirosStoreSupabase = ParceirosStoreSupabase;
})(window);
