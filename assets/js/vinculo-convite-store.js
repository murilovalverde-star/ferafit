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

  global.VinculoConviteStore = VinculoConviteStoreSupabase;
  global.VinculoConviteStoreSupabase = VinculoConviteStoreSupabase;
})(typeof window !== "undefined" ? window : global);
