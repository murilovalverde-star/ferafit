// =============================================================
// Fera Fit — Camada de dados do FEEDBACK DO BETA (módulo "Feedback
// do Beta" do admin.html)
//
// D038 do Orquestrador (2026-09-29): construir o módulo seguindo a
// proposta da Suporte ao Beta (D012 dela, pasta `Fera Fit beta
// support triage`, lida só leitura) — em demonstração, com a
// implementação Supabase pronta mas desligada, mesmo padrão já
// usado em `parceiros-store.js` (D036/D037).
//
// O feedback de verdade já chega à tabela `beta_feedback`
// (migration 006 da Backend, lida por inteiro, só leitura): canal
// (`pos_treino`/`botao_flutuante`), reação (só pós-treino: `otimo`,
// `pesado`, `facil`, `problema`), categoria (7 valores:
// `exercicio_errado`, `carga_estranha`, `app_travou`, `cronometro`,
// `sugestao`, `duvida`, `elogio`), `tela_atual` (só botão
// flutuante), `versao_app`, data e pontos. Sem texto livre, por
// decisão da própria Suporte (evita dado de saúde entrando por
// campo aberto).
//
// A leitura real usa a política RLS "feedback: admin lê tudo", que
// já existe na 006 — não precisa de Edge Function nem de função
// nova no banco, só um SELECT direto, protegido por RLS, com a
// chave `publishable`. O que falta é o login de admin de verdade
// (a Backend marcar Murilo/Gabriela como admin — D092 dela). Até
// lá, `global.FeedbackStore` fica em `FeedbackStoreDemo`.
//
// --- Sugestão de IA por categoria (adaptação registrada no
//     STATUS.md, P27) ---
// A proposta da Suporte (D012) foi escrita com 4 categorias
// hipotéticas ("Bug"/"Sugestão"/"Dúvida"/"Elogio") tiradas de um
// print, antes de o Orquestrador confirmar os 7 valores reais da
// tabela. Adaptei o CRITÉRIO dela (não o rótulo) aos valores reais:
//   - problema de treino/carga (`exercicio_errado`, `carga_estranha`)
//     → Lógica e Testes
//   - problema técnico da tela/app (`app_travou`, `cronometro`)
//     → Dev Mobile
//   - dúvida de conta/login/sincronização (`duvida`)
//     → Backend e Infraestrutura
//   - `sugestao`/`elogio` → Murilo decide prioridade (sugestão
//     repetida entre testadores diferentes pesa mais — mesma nota
//     da Suporte)
//
// --- Regra de urgência (D038, interpretação registrada no P27) ---
// "3 ou mais problemas na mesma tela no mesmo dia": só existe no
// canal `botao_flutuante` (é o único que grava `tela_atual`), entre
// as 4 categorias-problema acima.
// "Qualquer problema no treino em andamento": qualquer registro com
// `reacao = 'problema'` no canal `pos_treino` — é o item que a
// Suporte marcou como prioridade máxima (perda de progresso,
// cálculo de tempo, carga, logo depois do treino que acabou).
// =============================================================

(function (global) {
  "use strict";

  var CATEGORIAS = ["exercicio_errado", "carga_estranha", "app_travou", "cronometro", "sugestao", "duvida", "elogio"];
  var CATEGORIAS_PROBLEMA = ["exercicio_errado", "carga_estranha", "app_travou", "cronometro"];

  var ROTULOS_CATEGORIA = {
    exercicio_errado: "Exercício errado",
    carga_estranha: "Carga estranha",
    app_travou: "App travou",
    cronometro: "Cronômetro",
    sugestao: "Sugestão",
    duvida: "Dúvida",
    elogio: "Elogio"
  };

  var ROTULOS_REACAO = {
    otimo: "Ótimo",
    pesado: "Pesado demais",
    facil: "Fácil demais",
    problema: "Teve problema"
  };

  var ROTULOS_CANAL = {
    pos_treino: "Pós-treino",
    botao_flutuante: "Botão flutuante"
  };

  var IA_SUGERIDA = {
    exercicio_errado: "Lógica e Testes",
    carga_estranha: "Lógica e Testes",
    app_travou: "Dev Mobile",
    cronometro: "Dev Mobile",
    duvida: "Backend e Infraestrutura",
    sugestao: "Murilo (prioridade de produto)",
    elogio: "Murilo (sem ação — só contabiliza)"
  };

  function hojeISO(timestampMs) {
    return new Date(timestampMs).toISOString().slice(0, 10);
  }

  // ===========================================================
  // Funções puras de cálculo — compartilhadas pelas duas
  // implementações (Demo e Supabase), sempre operam sobre o array
  // de itens já carregado, nunca tocam em rede/armazenamento.
  // ===========================================================
  var FeedbackUtil = {};

  FeedbackUtil.CATEGORIAS = CATEGORIAS.slice();
  FeedbackUtil.CATEGORIAS_PROBLEMA = CATEGORIAS_PROBLEMA.slice();
  FeedbackUtil.ROTULOS_CATEGORIA = ROTULOS_CATEGORIA;
  FeedbackUtil.ROTULOS_REACAO = ROTULOS_REACAO;
  FeedbackUtil.ROTULOS_CANAL = ROTULOS_CANAL;
  FeedbackUtil.IA_SUGERIDA = IA_SUGERIDA;

  FeedbackUtil.resumoPorCategoria = function (itens) {
    var contagem = {};
    CATEGORIAS.forEach(function (c) { contagem[c] = 0; });
    itens.forEach(function (i) {
      if (i.categoria && contagem.hasOwnProperty(i.categoria)) {
        contagem[i.categoria]++;
      }
    });
    return CATEGORIAS.map(function (c) {
      return { categoria: c, rotulo: ROTULOS_CATEGORIA[c], iaSugerida: IA_SUGERIDA[c], contagem: contagem[c] };
    });
  };

  FeedbackUtil.resumoPorTela = function (itens) {
    var contagem = {};
    itens.forEach(function (i) {
      if (!i.telaAtual) { return; }
      contagem[i.telaAtual] = (contagem[i.telaAtual] || 0) + 1;
    });
    return Object.keys(contagem)
      .sort(function (a, b) { return contagem[b] - contagem[a]; })
      .map(function (t) { return { tela: t, contagem: contagem[t] }; });
  };

  FeedbackUtil.versoesDisponiveis = function (itens) {
    var vistos = {};
    var lista = [];
    itens.forEach(function (i) {
      if (i.versaoApp && !vistos[i.versaoApp]) {
        vistos[i.versaoApp] = true;
        lista.push(i.versaoApp);
      }
    });
    return lista.sort().reverse();
  };

  FeedbackUtil.itensUrgentes = function (itens) {
    var urgentes = [];

    // Regra 2 (qualquer problema no treino em andamento).
    itens.forEach(function (i) {
      if (i.canal === "pos_treino" && i.reacao === "problema") {
        urgentes.push({
          tipo: "reacao_problema",
          item: i,
          motivo: "Reação \"Teve problema\" logo após o treino."
        });
      }
    });

    // Regra 1 (3+ problemas na mesma tela no mesmo dia).
    var porTelaDia = {};
    itens.forEach(function (i) {
      if (i.canal === "botao_flutuante" && CATEGORIAS_PROBLEMA.indexOf(i.categoria) !== -1 && i.telaAtual) {
        var dia = hojeISO(i.criadoEm);
        var chave = i.telaAtual + "|" + dia;
        porTelaDia[chave] = porTelaDia[chave] || [];
        porTelaDia[chave].push(i);
      }
    });
    Object.keys(porTelaDia).forEach(function (chave) {
      var grupo = porTelaDia[chave];
      if (grupo.length >= 3) {
        var partes = chave.split("|");
        urgentes.push({
          tipo: "volume_tela_dia",
          tela: partes[0],
          dia: partes[1],
          quantidade: grupo.length,
          itens: grupo,
          motivo: grupo.length + " problemas na tela \"" + partes[0] + "\" em " + partes[1] + "."
        });
      }
    });

    // Mais recente/maior primeiro.
    urgentes.sort(function (a, b) {
      var tsA = a.item ? a.item.criadoEm : Date.parse(a.dia);
      var tsB = b.item ? b.item.criadoEm : Date.parse(b.dia);
      return tsB - tsA;
    });
    return urgentes;
  };

  function aplicarFiltros(itens, filtros) {
    filtros = filtros || {};
    return itens.filter(function (i) {
      if (filtros.versaoApp && i.versaoApp !== filtros.versaoApp) { return false; }
      if (filtros.tela && i.telaAtual !== filtros.tela) { return false; }
      if (filtros.categoria && i.categoria !== filtros.categoria) { return false; }
      return true;
    });
  }

  // ===========================================================
  // IMPLEMENTAÇÃO DE DEMONSTRAÇÃO — dados de exemplo fixos, só
  // para o painel ter o que mostrar. Nenhum dado real de testador.
  // ===========================================================
  var AGORA = Date.now();
  function horasAtras(h) { return AGORA - h * 60 * 60 * 1000; }

  var ITENS_EXEMPLO = [
    { id: "fb_ex_01", criadoEm: horasAtras(2), canal: "pos_treino", reacao: "problema", categoria: "exercicio_errado", telaAtual: null, versaoApp: "v37", pontos: 5 },
    { id: "fb_ex_02", criadoEm: horasAtras(3), canal: "botao_flutuante", reacao: null, categoria: "app_travou", telaAtual: "Exercicio", versaoApp: "v37", pontos: 15 },
    { id: "fb_ex_03", criadoEm: horasAtras(4), canal: "botao_flutuante", reacao: null, categoria: "app_travou", telaAtual: "Exercicio", versaoApp: "v37", pontos: 15 },
    { id: "fb_ex_04", criadoEm: horasAtras(5), canal: "botao_flutuante", reacao: null, categoria: "cronometro", telaAtual: "Exercicio", versaoApp: "v37", pontos: 15 },
    { id: "fb_ex_05", criadoEm: horasAtras(6), canal: "pos_treino", reacao: "otimo", categoria: null, telaAtual: null, versaoApp: "v37", pontos: 5 },
    { id: "fb_ex_06", criadoEm: horasAtras(8), canal: "pos_treino", reacao: "pesado", categoria: null, telaAtual: null, versaoApp: "v37", pontos: 5 },
    { id: "fb_ex_07", criadoEm: horasAtras(10), canal: "botao_flutuante", reacao: null, categoria: "duvida", telaAtual: "Conta", versaoApp: "v37", pontos: 15 },
    { id: "fb_ex_08", criadoEm: horasAtras(20), canal: "botao_flutuante", reacao: null, categoria: "sugestao", telaAtual: "Evolução", versaoApp: "v37", pontos: 15 },
    { id: "fb_ex_09", criadoEm: horasAtras(22), canal: "botao_flutuante", reacao: null, categoria: "sugestao", telaAtual: "Evolução", versaoApp: "v37", pontos: 15 },
    { id: "fb_ex_10", criadoEm: horasAtras(26), canal: "pos_treino", reacao: "facil", categoria: null, telaAtual: null, versaoApp: "v36", pontos: 5 },
    { id: "fb_ex_11", criadoEm: horasAtras(30), canal: "botao_flutuante", reacao: null, categoria: "elogio", telaAtual: "Home", versaoApp: "v36", pontos: 15 },
    { id: "fb_ex_12", criadoEm: horasAtras(48), canal: "botao_flutuante", reacao: null, categoria: "carga_estranha", telaAtual: "Montar Treino", versaoApp: "v36", pontos: 15 },
    { id: "fb_ex_13", criadoEm: horasAtras(50), canal: "pos_treino", reacao: "problema", categoria: "carga_estranha", telaAtual: null, versaoApp: "v36", pontos: 5 },
    { id: "fb_ex_14", criadoEm: horasAtras(72), canal: "botao_flutuante", reacao: null, categoria: "duvida", telaAtual: "Loja", versaoApp: "v35", pontos: 15 }
  ];

  var FeedbackStoreDemo = {};

  FeedbackStoreDemo.listarFeedback = function (filtros) {
    var itens = aplicarFiltros(ITENS_EXEMPLO, filtros)
      .slice()
      .sort(function (a, b) { return b.criadoEm - a.criadoEm; });
    return Promise.resolve(itens);
  };

  FeedbackStoreDemo.listarTodosSemFiltro = function () {
    return Promise.resolve(ITENS_EXEMPLO.slice());
  };

  // ===========================================================
  // IMPLEMENTAÇÃO SUPABASE — escrita e testada, mas DESLIGADA.
  //
  // Um SELECT direto em `beta_feedback` já basta (a política RLS
  // "feedback: admin lê tudo" da migration 006 cobre isso sozinha —
  // nenhuma Edge Function, nenhuma função nova no banco). O que
  // falta é o login de admin de verdade: hoje `admin.html` só tem
  // login cosmético (admin/admin), sem Supabase Auth, então mesmo
  // que a chave `publishable` chame este SELECT, a RLS vê um
  // usuário não-admin (ou nem autenticado) e devolve 0 linhas — a
  // Backend ainda precisa marcar Murilo/Gabriela como admin (D092).
  //
  // Só a chave `publishable`, nunca `service_role`.
  // ===========================================================

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vKEyW3okSfWu_RtxR-vbuw_Vl711Dy_";

  function clienteSupabaseFeedback() {
    if (clienteSupabaseFeedback._instancia) {
      return clienteSupabaseFeedback._instancia;
    }
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      throw new Error("Biblioteca do Supabase (assets/js/supabase.js) não está carregada nesta página.");
    }
    clienteSupabaseFeedback._instancia = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return clienteSupabaseFeedback._instancia;
  }

  // Permite injetar um cliente fake nos testes (Node.js).
  global.FeedbackStoreSupabaseTestes_definirCliente = function (clienteFake) {
    clienteSupabaseFeedback._instancia = clienteFake;
  };

  function linhaParaItem(linha) {
    return {
      id: linha.id,
      criadoEm: new Date(linha.created_at).getTime(),
      canal: linha.canal,
      reacao: linha.reacao,
      categoria: linha.categoria,
      telaAtual: linha.tela_atual,
      versaoApp: linha.versao_app,
      pontos: linha.pontos
    };
  }

  var FeedbackStoreSupabase = {};

  FeedbackStoreSupabase.listarFeedback = function (filtros) {
    filtros = filtros || {};
    var cliente = clienteSupabaseFeedback();
    var consulta = cliente.from("beta_feedback")
      .select("id, created_at, canal, reacao, categoria, tela_atual, versao_app, pontos")
      .order("created_at", { ascending: false });
    if (filtros.versaoApp) { consulta = consulta.eq("versao_app", filtros.versaoApp); }
    if (filtros.tela) { consulta = consulta.eq("tela_atual", filtros.tela); }
    if (filtros.categoria) { consulta = consulta.eq("categoria", filtros.categoria); }
    return consulta.then(function (resultado) {
      if (resultado.error) {
        throw new Error("Não deu para ler o feedback agora — confira se o login de admin está ativo.");
      }
      return (resultado.data || []).map(linhaParaItem);
    });
  };

  FeedbackStoreSupabase.listarTodosSemFiltro = function () {
    var cliente = clienteSupabaseFeedback();
    return cliente.from("beta_feedback")
      .select("id, created_at, canal, reacao, categoria, tela_atual, versao_app, pontos")
      .order("created_at", { ascending: false })
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para ler o feedback agora — confira se o login de admin está ativo.");
        }
        return (resultado.data || []).map(linhaParaItem);
      });
  };

  // ⚠️ NÃO TROCAR — depende do login real de admin (D092 da
  // Backend). Ver aviso completo no cabeçalho deste arquivo e no
  // STATUS.md (P27/D038).
  global.FeedbackStore = FeedbackStoreDemo;
  global.FeedbackStoreDemo = FeedbackStoreDemo;
  global.FeedbackStoreSupabase = FeedbackStoreSupabase;
  global.FeedbackUtil = FeedbackUtil;
})(window);
