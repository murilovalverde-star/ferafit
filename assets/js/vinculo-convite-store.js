// =============================================================
// Fera Fit — Camada de dados do vínculo do aluno pelo parceiro,
// por código (QR ou digitado) ou por convite de WhatsApp.
//
// D067 do Orquestrador (2026-10-09): o app já gera o código do
// aluno (gerar_convite(), migration 013) e a Backend já tem, em
// produção, as duas pontas do lado do parceiro -- mas nenhuma
// linha do site chamava nenhuma delas. Este arquivo é essa ponte.
//
// IMPORTANTE -- verificado direto no arquivo-fonte da Backend
// antes de escrever qualquer linha aqui, como a própria D067
// pediu ("não confie só neste texto"): a função
// `solicitar_vinculo_por_codigo(p_codigo text)` tinha, na
// migration 013 original, a assinatura `RETURNS void` e lançava
// exceção (`RAISE EXCEPTION`) em caso de erro. A Segurança achou
// (D027 dela) que esse RAISE desfazia, na mesma transação, o
// próprio registro da tentativa falhada -- por isso a trava de
// "5 falhas em 10 minutos" nunca disparava. A correção (D091) foi
// aplicada na migration 021, que troca `RAISE EXCEPTION` por um
// valor de retorno (`RETURNS text`), e essa correção está
// CONFIRMADA NO AR em produção desde 2026-09-30 (D096 da Backend,
// "Migration 021 está no ar em produção, confirmada"). Por isso
// este arquivo usa o contrato da 021, não o da 013 original:
//
//   solicitar_vinculo_por_codigo(p_codigo) RETURNS text
//     'ok'                — pedido registrado; falta o ALUNO
//                           confirmar no app.
//     'muitas_tentativas' — 5 falhas em 10 minutos da mesma conta;
//                           aguardar.
//     'convite_invalido'  — código errado, expirado, já usado, OU
//                           quem chamou não é personal/academia
//                           ativos -- a MESMA mensagem para os
//                           dois motivos, por desenho da própria
//                           função (não revelar qual dos dois
//                           aconteceu a quem está tentando
//                           adivinhar um código).
//
// Esta função NUNCA diferencia "código errado" de "código vencido"
// de "aluno já vinculado" de "vagas esgotadas" -- ela não checa
// vaga nenhuma (isso só acontece depois, quando o ALUNO confirma
// no app, em confirmar_vinculo_por_convite(), que nem é chamada
// daqui). A D067 pediu "use os erros reais que a função devolve" --
// é exatamente isso que este arquivo faz: mostra o texto real de
// cada status, em vez de inventar distinções que a função não faz.
//
// `gerar_convite_whatsapp()` (Caminho 1, D086 item 2, também na
// migration 021, também confirmada no ar) continua no modelo
// antigo (RAISE EXCEPTION em vez de status) -- não fazia parte da
// correção D091 porque não tem o padrão INSERT+RAISE que perdia o
// registro. Devolve a linha inteira de `convites` (código, validade
// de 48 horas) para o parceiro montar o link.
//
// Só a chave `publishable`, nunca `service_role` -- as duas funções
// são SECURITY DEFINER com RLS por trás; nenhuma tabela é lida ou
// gravada direto daqui.
// =============================================================

(function (global) {
  "use strict";

  var VinculoConviteStoreSupabase = {};

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
  global.VinculoConviteStoreSupabaseTestes_definirCliente = function (clienteFake) {
    clienteSupabase._instancia = clienteFake;
  };

  // Aceita o código com ou sem espaço, maiúscula ou minúscula (D067,
  // item 2) -- remove todo espaço em branco e normaliza para
  // maiúsculas antes de mandar para o banco. O alfabeto real
  // (gerar_convite(), 013) nunca usa espaço nem minúscula, então
  // isto só corrige o que a pessoa digitou, nunca muda um código
  // válido em outro.
  VinculoConviteStoreSupabase.normalizarCodigo = function (codigo) {
    return (codigo || "").replace(/\s+/g, "").toUpperCase();
  };

  // Devolve o status real da função (ver contrato no cabeçalho),
  // nunca inventa uma distinção que o banco não faz. Só rejeita a
  // Promise para um erro de verdade (rede, sessão expirada etc.) --
  // os três resultados esperados ('ok'/'muitas_tentativas'/
  // 'convite_invalido') chegam como resolve, porque não são exceção.
  VinculoConviteStoreSupabase.solicitarPorCodigo = function (codigo) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    var codigoNormalizado = VinculoConviteStoreSupabase.normalizarCodigo(codigo);
    if (codigoNormalizado.length !== 8) {
      return Promise.reject(new Error("O código tem 8 letras — confira e tente de novo."));
    }
    return cliente.rpc("solicitar_vinculo_por_codigo", { p_codigo: codigoNormalizado })
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error((resultado.error && resultado.error.message) || "Não deu para registrar o pedido agora.");
        }
        return resultado.data; // 'ok' | 'muitas_tentativas' | 'convite_invalido'
      });
  };

  // Caminho 1 (D086 item 2): gera o código de convite por WhatsApp,
  // válido por 48 horas. Esta função continua lançando exceção de
  // verdade em caso de erro (não foi convertida pela D091) -- o
  // texto real dela também é repassado, pelo mesmo motivo do item
  // acima: é a mensagem que a própria Backend escreveu para a
  // pessoa ler, não uma genérica.
  VinculoConviteStoreSupabase.gerarConviteWhatsapp = function () {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.rpc("gerar_convite_whatsapp", {})
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error((resultado.error && resultado.error.message) || "Não deu para gerar o convite agora.");
        }
        return resultado.data; // linha de `convites`: { codigo, expira_em, ... }
      });
  };

  // D069 do Orquestrador (2026-10-10), Parte 1 -- Murilo escolheu a
  // opção (a) da D068: a lista "Meus alunos" passa a mostrar também
  // quem tem vínculo ativo (pelo código/QR da D067), mesmo sem
  // ficha cadastrada à mão. Lê a view `vw_aluno_para_parceiro`
  // (migration 005/032, confirmada no ar), que já filtra pelo
  // parceiro certo via `pode_ver_aluno()` (RLS da própria view, não
  // desta função) -- por isso não recebe nenhum parâmetro de
  // parceiro aqui. SÓ LEITURA: esta função nunca grava nada em
  // `fichas_aluno_parceiro` -- abrir a ficha de verdade pela função
  // nova (sem INSERT direto com `aluno_user_id`) é a Parte 2,
  // ainda esperando a migration 042 da Backend.
  //
  // `peso_meta_kg` só existe na view a partir da migration 041,
  // ainda só-arquivo (D140 da Backend) no momento em que este
  // trecho foi escrito -- por isso o código em parceiro.html lê
  // esse campo de forma defensiva (undefined até a 041 publicar),
  // em vez de supor que ele sempre vem preenchido.
  // D073 (2026-10-12) -- achado: a coluna `congelado` da view é
  // computada por esta_congelado(), que só responde pro próprio
  // aluno, o patrocinador dele ou admin (migration 032 da Backend,
  // D111/D112) -- RAISE EXCEPTION pra qualquer outro parceiro. A
  // migration 041 (já em produção) recriou a view sem a proteção
  // que a 032 tinha posto nessa coluna (CASE que só chama a função
  // pra quem tem o direito), então hoje ela quebra o SELECT inteiro
  // pra qualquer parceiro com vínculo comum (não-patrocinado) --
  // registrado no STATUS (P64/P65) pra Backend mesclar as duas
  // migrations de vez. Enquanto isso não sobe, pedimos só as
  // colunas que a view sempre teve, SEM `congelado` -- como é uma
  // coluna computada dentro de uma view-SELECT simples (uma tabela
  // só, sem agregação), o Postgres poda do plano a coluna não
  // pedida e a função nunca chega a ser chamada. `aluno.congelado`
  // fica `undefined` em vez de `true`/`false` -- renderDetalheVinculado()
  // já trata isso (linha "Congelado" some da ficha em vez de
  // quebrar), sem precisar mudar mais nada.
  VinculoConviteStoreSupabase.listarAlunosVinculados = function () {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.from("vw_aluno_para_parceiro")
      .select("user_id,nome,objetivo,altura_cm,peso_inicial_kg,nivel,dias_por_semana,divisao,treino_numero,calibracoes,historico_cargas,progressao,medidas,sessoes,ultima_sincronizacao,peso_meta_kg")
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error((resultado.error && resultado.error.message) || "Não deu para carregar os alunos vinculados agora.");
        }
        return resultado.data || [];
      });
  };

  // D070 (2026-10-10) -- Parte 2 da D069, adiantada em cima da migration
  // 042 da Backend (fase2/sql/042_ficha_pelo_site_e_desfazer_vinculo.sql),
  // que já tem PASSA da Segurança (D063 dela) mas ainda NÃO está em
  // produção no momento em que este trecho foi escrito. Enquanto isso, o
  // PostgREST devolve "Could not find the function ... in the schema
  // cache" (código PGRST202) para as duas funções novas abaixo -- detecta
  // isso aqui e troca por uma mensagem amigável, exatamente como a D070
  // pede ("se a função não existir no banco, erro amigável, sem quebrar").
  function mensagemFuncaoAindaNaoExiste(erro) {
    var codigo = erro && erro.code;
    var texto = ((erro && erro.message) || "").toLowerCase();
    return codigo === "PGRST202" || texto.indexOf("could not find the function") !== -1;
  }

  // D080 -- aluno que sumiu (excluiu a conta): ponto unico em
  // aluno-indisponivel.js.
  function alunoSumiu(erroDoBanco) {
    return !!(global.AlunoIndisponivel && global.AlunoIndisponivel.ehErroDoBanco(erroDoBanco));
  }

  // D070 -- equivalente, para o SITE, da ficha_do_aluno_vinculado() que o
  // app já usa (migration 038, só personal) -- cobre personal E academia.
  // A própria função (042) confere vínculo aceito e em vigor antes de
  // devolver a ficha existente ou criar uma vazia -- NUNCA é feito INSERT
  // direto com aluno_user_id aqui, exatamente como a D069/D070 pedem.
  VinculoConviteStoreSupabase.abrirFichaVinculado = function (alunoId) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.rpc("ficha_do_aluno_vinculado_parceiro", { p_aluno_id: alunoId })
      .then(function (resultado) {
        if (resultado.error) {
          if (alunoSumiu(resultado.error)) { throw global.AlunoIndisponivel.criarErro(); } // D080
          if (mensagemFuncaoAindaNaoExiste(resultado.error)) {
            throw new Error("Essa função ainda não está em produção -- assim que a Backend publicar a migration 042, abrir a ficha passa a funcionar aqui.");
          }
          throw new Error((resultado.error && resultado.error.message) || "Não deu para abrir a ficha deste aluno agora.");
        }
        return resultado.data;
      });
  };

  // D070 -- "Desfazer vínculo" do lado do PARCEIRO (personal ou academia).
  // Nunca manda id de vínculo nem motivo -- a própria função (042) resolve
  // o vínculo vigente internamente e fixa o motivo (ver o cabeçalho da
  // migration, item 4b, sobre por que expor isso ao cliente seria
  // arriscado: deixaria o parceiro registrar "revogado_pelo_aluno" sem o
  // aluno ter agido, ou vice-versa).
  VinculoConviteStoreSupabase.desfazerVinculoComAluno = function (alunoId) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.rpc("encerrar_vinculo_com_aluno", { p_aluno_id: alunoId })
      .then(function (resultado) {
        if (resultado.error) {
          if (alunoSumiu(resultado.error)) { throw global.AlunoIndisponivel.criarErro(); } // D080
          if (mensagemFuncaoAindaNaoExiste(resultado.error)) {
            throw new Error("Essa função ainda não está em produção -- assim que a Backend publicar a migration 042, desfazer o vínculo passa a funcionar aqui.");
          }
          throw new Error((resultado.error && resultado.error.message) || "Não deu para desfazer esse vínculo agora.");
        }
        return resultado.data;
      });
  };

  // D074 (2026-10-14) -- aba "Desvinculados": leitura pos-vinculo de 30
  // dias, pelas duas funcoes da migration 044 (Backend D147, em producao).
  // SO LEITURA: nada aqui grava, reativa ou exclui. Nunca manda nada de
  // parceiro -- as proprias funcoes resolvem quem e o parceiro logado.
  //
  // meus_ex_alunos_em_leitura() -> linhas { aluno_id, nome,
  //   vinculo_encerrado_em, expira_em }. Fichas MANUAIS (sem vinculo de
  //   app) so entram aqui quando a Backend publicar a 045 (D148): quem
  //   decide o que aparece e a funcao, nao este codigo.
  VinculoConviteStoreSupabase.listarExAlunosEmLeitura = function () {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.rpc("meus_ex_alunos_em_leitura", {})
      .then(function (resultado) {
        if (resultado.error) {
          if (mensagemFuncaoAindaNaoExiste(resultado.error)) {
            throw new Error("A leitura de desvinculados ainda não está em produção -- assim que a Backend publicar a migration 044, a lista passa a funcionar aqui.");
          }
          throw new Error((resultado.error && resultado.error.message) || "Não deu para carregar os desvinculados agora.");
        }
        return resultado.data || [];
      });
  };

  // ficha_pos_vinculo_parceiro(p_aluno_id) -> RETURNS TABLE { nome,
  // contrato, anamnese, vinculo_encerrado_em, expira_em }. O PostgREST
  // devolve ARRAY mesmo com 1 linha (mesmo bug ja corrigido na D060,
  // metricas_periodo) -- desembrulha aqui, devolve a linha ou null.
  VinculoConviteStoreSupabase.buscarFichaPosVinculo = function (alunoId) {
    var cliente;
    try {
      cliente = clienteSupabase();
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.rpc("ficha_pos_vinculo_parceiro", { p_aluno_id: alunoId })
      .then(function (resultado) {
        if (resultado.error) {
          if (alunoSumiu(resultado.error)) { throw global.AlunoIndisponivel.criarErro(); } // D080
          if (mensagemFuncaoAindaNaoExiste(resultado.error)) {
            throw new Error("A leitura de desvinculados ainda não está em produção -- assim que a Backend publicar a migration 044, a ficha passa a abrir aqui.");
          }
          throw new Error((resultado.error && resultado.error.message) || "Não deu para abrir essa ficha agora.");
        }
        var dados = resultado.data;
        var linha = Array.isArray(dados) ? dados[0] : dados;
        return linha || null;
      });
  };

  global.VinculoConviteStore = VinculoConviteStoreSupabase;
  global.VinculoConviteStoreSupabase = VinculoConviteStoreSupabase;
})(typeof window !== "undefined" ? window : global);
