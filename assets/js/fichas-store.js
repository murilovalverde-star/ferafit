// =============================================================
// Fera Fit — Camada de dados da FICHA DO ALUNO (cadastrada pelo
// parceiro: academia OU personal) e do histórico de medições
//
// D045 do Orquestrador (2026-10-01), item 2 (6.6) -- "ler e gravar
// a ficha do aluno na tabela da 022, com busca e paginação. A
// anamnese só é vista por quem cadastrou e pelo admin. Da foto
// inicial, só a informação de que existe, nunca o arquivo."
//
// Escrito contra o contrato real (D100 da Backend):
//   C:\XGym\Fera Fit backend infrastructure\fase2\CONTRATO_para_Site_migrations_022_024.md
// e o SQL real da migration 022 (`022_dados_do_parceiro.sql`), os
// dois lidos na íntegra antes desta implementação -- não contra a
// SPEC_dados_parceiro_001.md antiga nem contra o que dados-demo.js
// já fazia em localStorage.
//
// Propositalmente um arquivo novo e separado de `dados-demo.js`
// (que continua cuidando só do modo de demonstração, sem nenhum
// conceito de parceiro real -- achado registrado na P34/STATUS.md)
// e de `parceiros-store.js` (que cuida de quem É parceiro -- login,
// cadastro, perfil -- não do que o parceiro FAZ com os alunos dele).
// Mesma separação de domínio que o próprio cabeçalho de
// `parceiros-store.js` já documenta.
//
// Segurança, por desenho (nunca reforçado aqui por redundância,
// porque o banco já fecha isso por RLS, conferido no SQL real antes
// de escrever, não presumido):
//   - `fichas_aluno_parceiro`/`medidas_parceiro` só são lidas e
//     escritas por quem cadastrou (`criado_por`) ou admin -- nem a
//     academia vê a ficha de um personal vinculado, nem o contrário.
//   - `anamnese` é dado de saúde (LGPD) -- este arquivo nunca loga,
//     cacheia ou exporta esse campo fora do fluxo normal de
//     ler/editar a ficha (mesmo aviso do contrato da Backend).
//   - `tem_foto_inicial` é só um booleano -- este arquivo nunca
//     envia nem espera um arquivo/bucket para foto de aluno.
//   - IMC nunca é gravado -- só calculado aqui, na hora, para
//     exibição (peso_kg / (altura_cm/100)^2).
//
// Só a chave `publishable`, nunca `service_role`. Nenhuma função
// RPC nova é chamada aqui -- o contrato confirma que a 022 não tem
// nenhuma função para o Site chamar; INSERT/UPDATE normais bastam,
// os dois triggers da 022 agem sozinhos.
// =============================================================

(function (global) {
  "use strict";

  var FichasStoreSupabase = {};

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
  global.FichasStoreSupabaseTestes_definirCliente = function (clienteFake) {
    clienteSupabase._instancia = clienteFake;
  };

  // Coluna dona da ficha/treino-base, conforme o tipo do parceiro
  // logado (minhaConta() de ParceirosStore já devolve {tipo, id}).
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

  // Colunas que esta camada aceita gravar direto da tela -- nunca
  // personal_id/academia_id/criado_por/aluno_user_id (identidade da
  // ficha, não se mexe por aqui) nem treino_* (item 3 da D045,
  // montador de treino, ainda não ligado).
  var CAMPOS_FICHA_GRAVAVEIS = [
    "nome", "data_nascimento", "cpf", "rg", "sexo", "email", "telefone",
    "endereco", "contato_emergencia_nome", "contato_emergencia_telefone",
    "observacao", "contrato", "anamnese", "testes_fisicos",
    "tem_foto_inicial", "profissao", "redes_sociais", "preferencia_horario",
    "dias_treino"
  ];

  function montarCorpoFicha(dados) {
    dados = dados || {};
    var corpo = {};
    CAMPOS_FICHA_GRAVAVEIS.forEach(function (campo) {
      if (dados[campo] !== undefined) {
        corpo[campo] = dados[campo];
      }
    });
    return corpo;
  }

  // --- Listar, com busca por nome e paginação (1-based) ---
  //
  // Busca só por nome (ilike) -- deliberado: cpf/telefone podem ter
  // formatação (pontuação/máscara) diferente do que foi digitado, e
  // caracteres como vírgula/parênteses quebram a sintaxe do filtro
  // .or() do PostgREST se vierem de texto livre do usuário. Nome
  // cobre o caso de uso principal (achar um aluno rápido numa lista).
  FichasStoreSupabase.listarFichas = function (parceiro, opcoes) {
    var cliente, coluna;
    try {
      cliente = clienteSupabase();
      coluna = colunaDono(parceiro);
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    opcoes = opcoes || {};
    var pagina = opcoes.pagina > 0 ? opcoes.pagina : 1;
    var porPagina = opcoes.porPagina > 0 ? opcoes.porPagina : 20;
    var de = (pagina - 1) * porPagina;
    var ate = de + porPagina - 1;

    var consulta = cliente
      .from("fichas_aluno_parceiro")
      .select("id,nome,email,telefone,data_nascimento,treino_modo,criado_em", { count: "exact" })
      .eq(coluna, parceiro.id)
      .order("nome", { ascending: true })
      .range(de, ate);

    var termo = (opcoes.busca || "").trim();
    if (termo) {
      consulta = consulta.ilike("nome", "%" + termo + "%");
    }

    return consulta.then(function (resultado) {
      if (resultado.error) {
        throw new Error("Não deu para buscar os alunos agora.");
      }
      return {
        itens: resultado.data || [],
        total: resultado.count || 0,
        pagina: pagina,
        porPagina: porPagina
      };
    });
  };

  // --- Buscar uma ficha completa (todos os campos, inclusive
  // anamnese -- RLS já garante que só quem cadastrou/admin chega
  // até aqui) ---
  FichasStoreSupabase.buscarFicha = function (fichaId) {
    var cliente = clienteSupabase();
    return cliente.from("fichas_aluno_parceiro").select("*").eq("id", fichaId).maybeSingle()
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para abrir essa ficha agora.");
        }
        if (!resultado.data) {
          throw new Error("Ficha não encontrada (ou você não tem acesso a ela).");
        }
        return resultado.data;
      });
  };

  // --- Criar ficha nova. `dados.nome` é obrigatório (única coluna
  // NOT NULL além das de identidade/dono, conferido no SQL real) ---
  FichasStoreSupabase.criarFicha = function (parceiro, dados) {
    var cliente, coluna;
    try {
      cliente = clienteSupabase();
      coluna = colunaDono(parceiro);
    } catch (erroSincrono) {
      return Promise.reject(erroSincrono);
    }
    var nome = ((dados && dados.nome) || "").trim();
    if (!nome) {
      return Promise.reject(new Error("Informe o nome do aluno."));
    }
    return usuarioAtual().then(function (uid) {
      var corpo = montarCorpoFicha(dados);
      corpo.nome = nome;
      corpo[coluna] = parceiro.id;
      corpo.criado_por = uid;
      return cliente.from("fichas_aluno_parceiro").insert(corpo).select("id").single()
        .then(function (resultado) {
          if (resultado.error) {
            throw new Error("Não deu para cadastrar esse aluno agora.");
          }
          return resultado.data;
        });
    });
  };

  // --- Atualização parcial (campos ausentes não são tocados) ---
  FichasStoreSupabase.atualizarFicha = function (fichaId, camposParciais) {
    var cliente = clienteSupabase();
    var corpo = montarCorpoFicha(camposParciais);
    if (corpo.nome !== undefined && !corpo.nome.trim()) {
      return Promise.reject(new Error("O nome do aluno não pode ficar vazio."));
    }
    if (Object.keys(corpo).length === 0) {
      return Promise.resolve({ id: fichaId });
    }
    return cliente.from("fichas_aluno_parceiro").update(corpo).eq("id", fichaId).select("id").single()
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para salvar essa ficha agora.");
        }
        return resultado.data;
      });
  };

  // --- Medições: histórico puro, nunca sobrescreve (append-only
  // "por natureza", conferido no comentário real da tabela) ---
  FichasStoreSupabase.listarMedicoes = function (fichaId) {
    var cliente = clienteSupabase();
    return cliente.from("medidas_parceiro").select("*").eq("ficha_id", fichaId)
      .order("data", { ascending: false })
      .then(function (resultado) {
        if (resultado.error) {
          throw new Error("Não deu para ler o histórico de medições agora.");
        }
        return resultado.data || [];
      });
  };

  var CAMPOS_MEDICAO_GRAVAVEIS = [
    "data", "altura_cm", "peso_kg", "percentual_gordura", "abdomen_cm",
    "quadril_cm", "peito_cm", "braco_cm", "coxa_cm", "panturrilha_cm"
  ];

  FichasStoreSupabase.adicionarMedicao = function (fichaId, medicao) {
    var cliente = clienteSupabase();
    medicao = medicao || {};
    return usuarioAtual().then(function (uid) {
      var corpo = { ficha_id: fichaId, registrado_por: uid };
      CAMPOS_MEDICAO_GRAVAVEIS.forEach(function (campo) {
        if (medicao[campo] !== undefined && medicao[campo] !== "") {
          corpo[campo] = medicao[campo];
        }
      });
      return cliente.from("medidas_parceiro").insert(corpo).select("id").single()
        .then(function (resultado) {
          if (resultado.error) {
            throw new Error("Não deu para registrar essa medição agora.");
          }
          return resultado.data;
        });
    });
  };

  // IMC nunca é gravado (coluna não existe de propósito) -- só
  // calculado aqui, para exibição. Devolve null se faltar peso/altura
  // ou se a altura for zero (evita divisão por zero).
  FichasStoreSupabase.calcularImc = function (pesoKg, alturaCm) {
    var peso = Number(pesoKg);
    var altura = Number(alturaCm);
    if (!peso || !altura) {
      return null;
    }
    var alturaM = altura / 100;
    return peso / (alturaM * alturaM);
  };

  global.FichasStore = FichasStoreSupabase;
  global.FichasStoreSupabase = FichasStoreSupabase;
})(typeof window !== "undefined" ? window : global);
