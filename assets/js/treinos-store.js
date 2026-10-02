// =============================================================
// Fera Fit — Camada de dados da BIBLIOTECA DE TREINOS-BASE do
// parceiro (até 20 por conta, academia OU personal) e da aplicação
// de um treino (base ou personalizado) na ficha do aluno.
//
// D045 do Orquestrador (2026-10-01), item 3 (6.5) -- "os treinos-base
// (até 20 por parceiro) e a aplicação ao aluno, gravados na 022." --
// e D050 (2026-10-02), que destrava este item e confirma o formato
// de cada exercício: `{grupo, subgrupo, src}` (D046), aqui com as
// colunas de prescrição também (`series`, `repeticoes`, `descanso`),
// e que `dias_treino` também entra nesta rodada.
//
// Escrito contra o SQL real da migration 022
// (`022_dados_do_parceiro.sql`, tabela `treinos_base_parceiro` e as
// colunas `treino_*` de `fichas_aluno_parceiro`), lido na íntegra
// antes desta implementação.
//
// Arquivo novo e separado de `fichas-store.js` (que cuida da ficha
// em si -- identificação, anamnese, medições) e de `dados-demo.js`
// (modo de demonstração, sem conceito de parceiro real) -- mesma
// separação de domínio já documentada nos dois arquivos.
//
// `src` de cada exercício é o identificador do MOTOR do app
// (`srcMotor` em `assets/data/MAPA_ID_MOTOR_PARA_CATALOGO_190.json`),
// não o id do catálogo do site -- é esse `src` que o motor usa como
// `calKey` para o histórico de carga do aluno. Este arquivo nunca
// decide esse mapeamento -- só grava e lê o que a tela (parceiro.html)
// já montou no formato certo.
//
// Só a chave `publishable`, nunca `service_role`. Os dois triggers
// reais da 022 (`checa_limite_treinos_base`, `valida_treino_base_da_ficha`)
// agem sozinhos no banco -- este arquivo só dá um aviso amigável
// ANTES de tentar o 21º treino-base (a lista já veio completa de
// `listarTreinosBase`), e trata com uma mensagem clara se, ainda
// assim, o banco rejeitar (corrida entre duas abas, por exemplo).
// =============================================================

(function (global) {
  "use strict";

  var TreinosStoreSupabase = {};

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vKEyW3okSfWu_RtxR-vbuw_Vl711Dy_";

  var MAX_TREINOS_BASE = 20;

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
  global.TreinosStoreSupabaseTestes_definirCliente = function (clienteFake) {
    clienteSupabase._instancia = clienteFake;
  };

  // Mesma função de fichas-store.js, repetida aqui de propósito --
  // os dois arquivos são domínios separados e não importam um do
  // outro (nenhum dos dois depende da ordem de carregamento do outro
  // na página).
  function colunaDono(parceiro) {
    if (!parceiro || (parceiro.tipo !== "personal" && parceiro.tipo !== "academia")) {
      throw new Error("Parceiro inválido -- tipo deve ser 'personal' ou 'academia'.");
    }
    return parceiro.tipo === "personal" ? "personal_id" : "academia_id";
  }

  function usuarioAtual() {
    var cliente = clienteSupabase();
    return cliente.auth.getUser().then(function (resultado) {
      if (resultado.error || !resultado.data || !resultado.data.user) {
        throw new Error("Sessão inválida -- faça login de novo.");
      }
      return resultado.data.user.id;
    });
  }

  // Cada item: {grupo, subgrupo, src, series, repeticoes, descanso}
  // (D046/D050). Este arquivo não valida o conteúdo de cada campo
  // (isso é papel de quem monta a lista, na tela) -- só garante que
  // o que entra na coluna `exercicios`/`treino_exercicios` é sempre
  // um array (nunca undefined/objeto solto).
  function listaDeExerciciosValida(exercicios) {
    return Array.isArray(exercicios) ? exercicios : [];
  }

  function mensagemDoLimite(erro) {
    var texto = (erro && erro.message) || "";
    if (texto.indexOf("Limite de 20 treinos-base") !== -1) {
      return new Error("Limite de " + MAX_TREINOS_BASE + " treinos-base por parceiro atingido. Apague algum antes de criar um novo.");
    }
    return null;
  }

  // --- Biblioteca de treinos-base ---

  TreinosStoreSupabase.listarTreinosBase = function (parceiro) {
    var cliente, coluna;
    try {
      cliente = clienteSupabase();
      coluna = colunaDono(parceiro);
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    return cliente.from("treinos_base_parceiro").select("*").eq(coluna, parceiro.id)
      .order("nome", { ascending: true })
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para listar os treinos-base agora.");
        }
        return resultado.data || [];
      });
  };

  TreinosStoreSupabase.buscarTreinoBase = function (treinoBaseId) {
    var cliente = clienteSupabase();
    return cliente.from("treinos_base_parceiro").select("*").eq("id", treinoBaseId).maybeSingle()
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para abrir esse treino-base agora.");
        }
        if (!resultado.data) {
          throw new Error("Treino-base não encontrado (ou você não tem acesso a ele).");
        }
        return resultado.data;
      });
  };

  // `avisoLimiteAtual` é opcional -- quando o chamador já sabe quantos
  // a conta tem (de um `listarTreinosBase` recente), evita round-trip
  // extra só para contar. Mesmo assim, o banco é quem decide de verdade
  // (trigger `checa_limite_treinos_base`) -- a mensagem abaixo é só
  // para o caso raro de essa contagem ter ficado desatualizada.
  TreinosStoreSupabase.criarTreinoBase = function (parceiro, nome, exercicios) {
    var cliente, coluna;
    try {
      cliente = clienteSupabase();
      coluna = colunaDono(parceiro);
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    var nomeLimpo = (nome || "").trim();
    if (!nomeLimpo) {
      return Promise.reject(new Error("Dê um nome para o treino-base (ex: \"Base iniciante\")."));
    }
    return usuarioAtual().then(function (uid) {
      var corpo = {
        nome: nomeLimpo,
        exercicios: listaDeExerciciosValida(exercicios),
        criado_por: uid
      };
      corpo[coluna] = parceiro.id;
      return cliente.from("treinos_base_parceiro").insert(corpo).select("id").single()
        .then(function (resultado) {
          if (resultado.error) {
            throw mensagemDoLimite(resultado.error) || new Error("Não deu para criar esse treino-base agora.");
          }
          return resultado.data;
        });
    });
  };

  // Atualização parcial -- `dadosParciais.nome` e/ou `.exercicios`.
  TreinosStoreSupabase.atualizarTreinoBase = function (treinoBaseId, dadosParciais) {
    var cliente = clienteSupabase();
    dadosParciais = dadosParciais || {};
    var corpo = {};
    if (dadosParciais.nome !== undefined) {
      var nomeLimpo = (dadosParciais.nome || "").trim();
      if (!nomeLimpo) {
        return Promise.reject(new Error("O nome do treino-base não pode ficar vazio."));
      }
      corpo.nome = nomeLimpo;
    }
    if (dadosParciais.exercicios !== undefined) {
      corpo.exercicios = listaDeExerciciosValida(dadosParciais.exercicios);
    }
    if (Object.keys(corpo).length === 0) {
      return Promise.resolve({ id: treinoBaseId });
    }
    return cliente.from("treinos_base_parceiro").update(corpo).eq("id", treinoBaseId).select("id").single()
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para salvar esse treino-base agora.");
        }
        return resultado.data;
      });
  };

  // Apagar um treino-base não mexe nas fichas que já o aplicaram --
  // `treino_base_id` vira NULL sozinho (ON DELETE SET NULL, conferido
  // no SQL real) e `treino_exercicios` continua com a cópia que já
  // tinha sido feita na hora da aplicação (nunca um link vivo).
  TreinosStoreSupabase.excluirTreinoBase = function (treinoBaseId) {
    var cliente = clienteSupabase();
    return cliente.from("treinos_base_parceiro").delete().eq("id", treinoBaseId)
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para apagar esse treino-base agora.");
        }
        return true;
      });
  };

  TreinosStoreSupabase.MAX_TREINOS_BASE = MAX_TREINOS_BASE;

  global.TreinosStore = TreinosStoreSupabase;
  global.TreinosStoreSupabase = TreinosStoreSupabase;
})(typeof window !== "undefined" ? window : global);
