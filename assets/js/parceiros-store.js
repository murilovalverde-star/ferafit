// =============================================================
// Fera Fit — Camada de dados de PARCEIROS (cadastro, aprovação,
// perfil e cobrança de academias e personais)
//
// D036 do Orquestrador (2026-09-29): "camada de dados trocável —
// demonstração hoje, Supabase depois". Este arquivo separa uma
// interface única (as funções que as telas chamam) com duas
// implementações: `ParceirosStoreDemo` (tudo em localStorage, ativa
// hoje) e `ParceirosStoreSupabase`. Trocar de demo para Supabase é
// trocar só a linha `global.ParceirosStore = ParceirosStoreDemo;` no
// fim deste arquivo — nenhuma tela (admin.html, parceiro.html) muda.
//
// D037 do Orquestrador (2026-09-29): login, cadastro (academia e
// personal, via Edge Function) e fotos de `ParceirosStoreSupabase`
// já estão implementados de verdade e testados localmente (Node.js +
// Playwright, cliente Supabase mockado) — seguindo o código real da
// Backend (migration 019 e as duas Edge Functions, lidas só leitura).
// AINDA ASSIM, a linha `global.ParceirosStore` no fim deste arquivo
// continua em `ParceirosStoreDemo`: a migration 019 tem, no próprio
// arquivo dela, "SÓ O ARQUIVO... Não aplique. Nada aqui foi rodado em
// produção" — então o banco real ainda rejeitaria esses caminhos. A
// troca só acontece depois que a Backend confirmar (D089 dela) que a
// 019 foi aplicada. As 19 funções de gestão do admin (aprovar,
// cobrança, faixas etc.) continuam como stub — dependem da 020/022,
// que a Backend ainda não escreveu (D037, item 3).
//
// Nenhuma linha deste arquivo chama tabela nova do Supabase direto
// (cadastro passa pela Edge Function, nunca por INSERT do navegador —
// a própria 019 bloqueia esse caminho de propósito) nem usa chave
// além da `publishable`.
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
      // D042 (2026-09-30) — apresentação pública, texto livre curto.
      // Corresponde à coluna academias.apresentacao da migration 024
      // (Backend, ainda não aplicada) — 500 caracteres é limite de tela
      // (maxlength em parceiro.html); aqui só reforça o mesmo teto.
      apresentacao: (dados.apresentacao || "").trim().slice(0, 500),
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
      // D042 (2026-09-30) — apresentação pública, texto livre curto.
      // Corresponde à coluna personais.apresentacao da migration 024
      // (Backend, ainda não aplicada) — 500 caracteres é limite de tela
      // (maxlength em parceiro.html); aqui só reforça o mesmo teto.
      apresentacao: (dados.apresentacao || "").trim().slice(0, 500),
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
  // IMPLEMENTAÇÃO SUPABASE — D037 do Orquestrador (2026-09-29).
  //
  // Cobre só o que a migration 019 (`fase2/sql/019_parceiro_auth_e_
  // fotos.sql`, lida por inteiro, só leitura) e as Edge Functions
  // `signup-personal`/`signup-academia` (lidas por inteiro, só
  // leitura) já resolvem hoje: LOGIN, CADASTRO e FOTOS. As 19 funções
  // de gestão do admin (aprovar, cobrança, faixas etc.) continuam
  // como stub abaixo — dependem das migrations 020/022, que a
  // Backend ainda não escreveu (D037, item 3).
  //
  // ⚠️ A migration 019 tem, no próprio arquivo, o aviso "SÓ O
  // ARQUIVO... Não aplique. Nada aqui foi rodado em produção." —
  // esta implementação foi escrita e testada localmente, mas o site
  // publicado continua em `ParceirosStoreDemo` (ver a última linha
  // deste arquivo) até a Backend confirmar (D089 dela) que a 019 foi
  // de fato aplicada. Trocar a chave abaixo antes disso quebraria o
  // site ao vivo, porque o banco real ainda rejeita esses caminhos.
  //
  // Só a chave `publishable`, nunca `service_role` — em nenhuma
  // função deste arquivo.
  //
  // Campos enviados às Edge Functions são exatamente os que elas
  // aceitam hoje (Edge Function ignora qualquer campo a mais, mas
  // esta implementação já nem envia): `signup-personal` só recebe
  // `nome_exibicao`/`cref`; `signup-academia` só recebe `nome`/
  // `cidade`/`uf`. Os demais campos que o formulário do site já
  // coleta (Formação, Especialização, CNPJ, Endereço, Responsável,
  // Telefone) não têm coluna em `personais`/`academias` ainda — TODO
  // sinalizado no próprio código da Backend, não desta IA.
  // ===========================================================

  var ParceirosStoreSupabase = {};

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vKEyW3okSfWu_RtxR-vbuw_Vl711Dy_";

  // Convenção de path da migration 019 (seção 5, comentário técnico):
  // bucket de PERFIL não tem subpasta (id é o próprio nome do
  // arquivo); bucket de GALERIA tem subpasta por id + arquivo com
  // nome aleatório dentro dela.
  var BUCKETS = {
    academia: { perfil: "foto-perfil-academia", galeria: "galeria-academia" },
    personal: { perfil: "foto-perfil-personal", galeria: "galeria-personal" }
  };

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
  global.ParceirosStoreSupabaseTestes_definirCliente = function (clienteFake) {
    clienteSupabase._instancia = clienteFake;
  };

  function extensaoArquivo(arquivo) {
    var nome = (arquivo && arquivo.name) || "";
    var partes = nome.split(".");
    if (partes.length > 1) {
      return partes[partes.length - 1].toLowerCase();
    }
    // Sem nome com extensão (ex.: blob) — cai para o tipo MIME.
    var tipo = (arquivo && arquivo.type) || "";
    if (tipo.indexOf("png") !== -1) return "png";
    if (tipo.indexOf("webp") !== -1) return "webp";
    return "jpg";
  }

  function uuidSimples() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Traduz os códigos de erro documentados nas duas Edge Functions
  // (signup-personal/index.ts, signup-academia/index.ts) para uma
  // mensagem em português — nunca mostra o código cru na tela.
  var MENSAGENS_ERRO_EDGE_FUNCTION = {
    nome_exibicao_obrigatorio: "Informe seu nome de exibição.",
    nome_obrigatorio: "Informe o nome da academia.",
    nao_autenticado: "Sessão inválida — faça login de novo e tente outra vez.",
    metodo_nao_permitido: "Erro interno (método não permitido) — avise o suporte.",
    falha_cadastro: "Não deu para concluir o cadastro agora. Tenta de novo em instantes."
  };

  function mensagemErroEdgeFunction(corpoResposta) {
    var codigo = corpoResposta && corpoResposta.error;
    return MENSAGENS_ERRO_EDGE_FUNCTION[codigo] || "Não deu para concluir o cadastro agora. Tenta de novo em instantes.";
  }

  // Chama uma Edge Function de cadastro (signup-personal ou
  // signup-academia) com o token da sessão recém-criada pelo signUp.
  // Nunca insere direto em personais/academias — a 019 bloqueia isso
  // de propósito (REVOKE INSERT), e é a Edge Function (service_role,
  // do lado do servidor) quem cria a linha e atribui o papel.
  function chamarEdgeFunctionCadastro(nomeFuncao, accessToken, corpo) {
    return global.fetch(SUPABASE_URL + "/functions/v1/" + nomeFuncao, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + accessToken
      },
      body: JSON.stringify(corpo)
    }).then(function (resposta) {
      return resposta.json().catch(function () { return {}; }).then(function (corpoResposta) {
        if (!resposta.ok || !corpoResposta || corpoResposta.ok !== true) {
          throw new Error(mensagemErroEdgeFunction(corpoResposta));
        }
        return corpoResposta;
      });
    });
  }

  // --- Login (Supabase Auth, e-mail e senha — 019 não mexe em
  //     auth.users, só em personais/academias/storage) ---

  ParceirosStoreSupabase.entrarComEmailSenha = function (email, senha) {
    var cliente = clienteSupabase();
    return cliente.auth.signInWithPassword({ email: (email || "").trim(), password: senha || "" })
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("E-mail ou senha incorretos.");
        }
        return resultado.data;
      });
  };

  ParceirosStoreSupabase.sairDaConta = function () {
    var cliente = clienteSupabase();
    return cliente.auth.signOut();
  };

  // --- Cadastro (signUp + Edge Function — nunca INSERT direto) ---

  ParceirosStoreSupabase.cadastrarAcademia = function (dados) {
    dados = dados || {};
    var cliente = clienteSupabase();
    var email = (dados.email || "").trim();
    var senha = dados.senha || "";
    if (!email || !senha) {
      return Promise.reject(new Error("E-mail e senha são obrigatórios para o cadastro."));
    }
    return cliente.auth.signUp({ email: email, password: senha }).then(function (resultado) {
      if (resultado.error) {
        throw new Error(resultado.error.message || "Não deu para criar a conta agora.");
      }
      var sessao = resultado.data && resultado.data.session;
      if (!sessao || !sessao.access_token) {
        // Projeto configurado para exigir confirmação de e-mail antes de
        // liberar sessão — a Edge Function só pode ser chamada com um
        // access_token válido, então paramos aqui com uma mensagem clara
        // em vez de estourar um erro genérico de "token indefinido".
        throw new Error("Conta criada. Confirme seu e-mail antes de continuar o cadastro.");
      }
      return chamarEdgeFunctionCadastro("signup-academia", sessao.access_token, {
        nome: (dados.nome || "").trim(),
        cidade: (dados.cidade || "").trim() || undefined,
        uf: (dados.uf || "").trim() || undefined
      }).then(function (corpoResposta) {
        return {
          id: corpoResposta.academia_id,
          jaExistia: !!corpoResposta.ja_existia,
          userId: sessao.user && sessao.user.id
        };
      });
    });
  };

  ParceirosStoreSupabase.cadastrarPersonal = function (dados) {
    dados = dados || {};
    var cliente = clienteSupabase();
    var email = (dados.email || "").trim();
    var senha = dados.senha || "";
    if (!email || !senha) {
      return Promise.reject(new Error("E-mail e senha são obrigatórios para o cadastro."));
    }
    return cliente.auth.signUp({ email: email, password: senha }).then(function (resultado) {
      if (resultado.error) {
        throw new Error(resultado.error.message || "Não deu para criar a conta agora.");
      }
      var sessao = resultado.data && resultado.data.session;
      if (!sessao || !sessao.access_token) {
        throw new Error("Conta criada. Confirme seu e-mail antes de continuar o cadastro.");
      }
      return chamarEdgeFunctionCadastro("signup-personal", sessao.access_token, {
        nome_exibicao: (dados.nome || "").trim(),
        cref: (dados.cref || "").trim() || undefined
      }).then(function (corpoResposta) {
        return {
          id: corpoResposta.personal_id,
          jaExistia: !!corpoResposta.ja_existia,
          userId: sessao.user && sessao.user.id
        };
      });
    });
  };

  // --- Fotos (buckets privados da 019 — leitura só depois de
  //     aprovado; dono sempre escreve, mesmo antes da aprovação) ---

  // Foto de perfil: path SEM subpasta, um arquivo só por id (upsert
  // substitui a anterior).
  ParceirosStoreSupabase.enviarFotoPerfil = function (tipo, id, arquivo) {
    var bucket = BUCKETS[tipo] && BUCKETS[tipo].perfil;
    if (!bucket) {
      return Promise.reject(new Error("Tipo de parceiro inválido: " + tipo));
    }
    var cliente = clienteSupabase();
    var caminho = id + "." + extensaoArquivo(arquivo);
    return cliente.storage.from(bucket).upload(caminho, arquivo, { upsert: true }).then(function (resultado) {
      if (resultado.error) {
        throw new Error("Não deu para enviar a foto de perfil agora.");
      }
      return { caminho: caminho, bucket: bucket };
    });
  };

  // Galeria: path COM subpasta por id, nome de arquivo aleatório —
  // cada envio soma uma foto nova, nunca substitui.
  ParceirosStoreSupabase.enviarFotoGaleria = function (tipo, id, arquivo) {
    var bucket = BUCKETS[tipo] && BUCKETS[tipo].galeria;
    if (!bucket) {
      return Promise.reject(new Error("Tipo de parceiro inválido: " + tipo));
    }
    var cliente = clienteSupabase();
    var caminho = id + "/" + uuidSimples() + "." + extensaoArquivo(arquivo);
    return cliente.storage.from(bucket).upload(caminho, arquivo, { upsert: false }).then(function (resultado) {
      if (resultado.error) {
        throw new Error("Não deu para enviar essa foto da galeria agora.");
      }
      return { caminho: caminho, bucket: bucket };
    });
  };

  ParceirosStoreSupabase.listarFotosGaleria = function (tipo, id) {
    var bucket = BUCKETS[tipo] && BUCKETS[tipo].galeria;
    if (!bucket) {
      return Promise.reject(new Error("Tipo de parceiro inválido: " + tipo));
    }
    var cliente = clienteSupabase();
    return cliente.storage.from(bucket).list(id).then(function (resultado) {
      if (resultado.error) {
        throw new Error("Não deu para listar a galeria agora.");
      }
      return (resultado.data || []).map(function (item) {
        return { nome: item.name, caminho: id + "/" + item.name };
      });
    });
  };

  ParceirosStoreSupabase.removerFotoGaleria = function (tipo, id, caminho) {
    var bucket = BUCKETS[tipo] && BUCKETS[tipo].galeria;
    if (!bucket) {
      return Promise.reject(new Error("Tipo de parceiro inválido: " + tipo));
    }
    if (!caminho || caminho.indexOf(id + "/") !== 0) {
      return Promise.reject(new Error("Caminho de foto inválido para remoção."));
    }
    var cliente = clienteSupabase();
    return cliente.storage.from(bucket).remove([caminho]).then(function (resultado) {
      if (resultado.error) {
        throw new Error("Não deu para apagar essa foto agora.");
      }
      return true;
    });
  };

  // URL assinada e temporária (buckets são privados — nunca há URL
  // pública fixa). A RLS da 019 decide, na hora de gerar a URL, se
  // quem está pedindo pode ler aquele arquivo (dono, admin, ou
  // qualquer autenticado só depois da aprovação).
  ParceirosStoreSupabase.urlFotoAssinada = function (tipoBucket, tipo, id, caminho, expiraEmSegundos) {
    var buckets = BUCKETS[tipo];
    var bucket = buckets && buckets[tipoBucket];
    if (!bucket) {
      return Promise.reject(new Error("Tipo de parceiro ou de foto inválido."));
    }
    var cliente = clienteSupabase();
    return cliente.storage.from(bucket).createSignedUrl(caminho, expiraEmSegundos || 3600).then(function (resultado) {
      if (resultado.error) {
        // Esperado quando o parceiro ainda não foi aprovado, ou quem
        // pede não é dono/admin — a RLS barra antes de gerar a URL.
        return null;
      }
      return resultado.data && resultado.data.signedUrl;
    });
  };

  // --- Funções de gestão do admin — fora de escopo da D037 (item 3:
  //     dependem das migrations 020/022, que a Backend ainda vai
  //     escrever). Continuam como stub. ---
  [
    "listarPendentes", "listarAtivos", "listarTodos",
    "perfilParceiro", "aprovarParceiro", "recusarParceiro", "suspenderParceiro", "reativarParceiro",
    "historicoAcoesAdmin", "registrarCobranca", "registrarPagamento", "registrarAjuste",
    "historicoCobranca", "statusCobranca", "listarFaixas", "definirPrecoFaixa", "definirFaixaParceiro"
  ].forEach(function (nomeFuncao) {
    ParceirosStoreSupabase[nomeFuncao] = function () {
      throw new Error("ParceirosStore (Supabase): '" + nomeFuncao + "' ainda não implementada — aguarda o banco real (D087 da Backend, migration 020/022).");
    };
  });

  // ⚠️ NÃO TROCAR — o site publicado continua em demonstração até a
  // Backend confirmar (D089 dela) que a migration 019 foi aplicada em
  // produção. Ver aviso completo no cabeçalho da seção Supabase acima
  // e no STATUS.md (P26/D037).
  global.ParceirosStore = ParceirosStoreDemo;
  global.ParceirosStoreDemo = ParceirosStoreDemo;
  global.ParceirosStoreSupabase = ParceirosStoreSupabase;
})(window);
