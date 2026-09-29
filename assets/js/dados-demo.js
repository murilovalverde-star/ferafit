// =============================================================
// Fera Fit — Camada de dados de demonstração
//
// Tudo aqui vive no localStorage do navegador de quem está testando.
// Nenhuma linha deste arquivo fala com o Supabase para ler ou escrever
// dado de aluno, academia ou personal — só lê imagens públicas do
// bucket "capas-43" (sem necessidade de login).
//
// Isolado numa camada só (pedido explícito da D032, item 1): quando o
// login de verdade e o Supabase entrarem, é este arquivo que muda —
// as telas que o chamam não precisam mudar.
//
// D032 (2026-09-25): catálogo, alunos (nome só) e treino simples.
// 2026-09-29 (pedido direto de Murilo, sem número de demanda): cadastro
// completo de aluno (22 campos Academia / 30 campos Personal, conforme
// `Modelo_Cadastro_Academia_e_Personal.xlsx`), ID único gerado pelo
// sistema (confirmado por Murilo — não é campo de formulário, e vale
// pros dois tipos de conta), medições com histórico, treinos-base
// (até 20 por profissional), sugestão de exercício, e o motor de
// pré-preenchimento por tipo de treino/tempo/série/descanso — baseado
// em `RESUMO_TREINOS_PARA_SITE.md` (Lógica e Testes, 2026-09-29).
//
// 2026-09-29 (D035 do Orquestrador): a Lógica e Testes resolveu na origem
// o achado acima — entregou `MAPA_ID_MOTOR_PARA_CATALOGO_190.json` com os
// 190 de 190 identificadores do motor pareados com o catálogo do site (0
// sem par), e corrigiu a seção 6 de `RESUMO_TREINOS_PARA_SITE.md` com o
// id exato do catálogo do site em cada exercício do exemplo (treino nº1,
// fase ouro). O pré-preenchimento abaixo agora usa esse ID exato como
// primeira opção em cada slot (`escolherExercicioExato`) — o mesmo
// exercício que o motor do app entregaria — e só cai para a escolha por
// grupo/subgrupo (mitigação antiga, ainda existe como reserva) quando o
// exato não está disponível: aparelho excluído pela academia, ou quando o
// treino passa de 9 exercícios e repete a ordem de prioridade numa 2ª
// volta (aí não há um 2º id de referência, só o padrão do grupo/subgrupo).
// Conferido exercício por exercício contra os 32 blocos (16 dias × 2
// sexos) da seção 6 corrigida — paridade exata em todos, 0 substituições
// — e com uma regressão de 1152 combinações de tempo/série/descanso sem
// erro. `MAPA_ID_MOTOR_PARA_CATALOGO_190.json` foi copiado para
// `assets/data/` (fonte: `Fera Fit logic and tests`, sha256
// af2f9d27263f9285b16da4f5cf2320ddf3061df740bfb1eb07015d4629c8a4d7) —
// ver STATUS.md para o registro completo.
//
// 2026-09-29 (rodada 2 de feedback, P24 do STATUS.md): validação de
// CPF (dígito verificador), formatação de telefone/telefone de
// emergência (+55 (DD) 9XXXX-XXXX) e campo `observacao` (privado,
// visível só a quem cadastrou o aluno — ver nota no esqueleto abaixo).
// `consultarCEP` chama o ViaCEP (viacep.com.br) para autofill de
// endereço — é um serviço público de terceiros (não é dos Correios,
// que cobram por contrato comercial; verificado antes de implementar),
// SEM relação com Supabase — a regra do parágrafo acima (nenhuma linha
// fala com o Supabase para dado de aluno/academia/personal) continua
// valendo à risca.
// =============================================================

(function (global) {
  "use strict";

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var BUCKET = "capas-43";
  var CHAVE_LOCALSTORAGE = "ferafit_demo_v2";
  var CHAVE_LOCALSTORAGE_V1 = "ferafit_demo_v1";
  var CATALOGO_URL = "assets/data/catalogo-exercicios.json";
  var MAX_TREINOS_BASE = 20;

  var catalogoCache = null;
  var catalogoPromise = null;

  function urlDaImagem(arquivo) {
    return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + arquivo;
  }

  function carregarCatalogo() {
    if (catalogoCache) {
      return Promise.resolve(catalogoCache);
    }
    if (!catalogoPromise) {
      catalogoPromise = fetch(CATALOGO_URL)
        .then(function (resp) {
          if (!resp.ok) {
            throw new Error("Não consegui carregar o catálogo de exercícios (HTTP " + resp.status + ").");
          }
          return resp.json();
        })
        .then(function (lista) {
          catalogoCache = lista;
          return lista;
        });
    }
    return catalogoPromise;
  }

  function estadoPadrao() {
    return {
      versao: 2,
      // Contador global do "ID único do aluno" (confirmado por Murilo,
      // 2026-09-29: gerado pelo sistema, não é campo de formulário,
      // compartilhado entre alunos cadastrados por Academia OU Personal).
      proximoIdAluno: 1,
      academia: {
        nome: "Academia de Teste",
        exerciciosNaoOferecidos: [],
        alunos: [],
        treinosBase: [],
        sugestoesExercicio: []
      },
      personal: {
        nome: "Personal de Teste",
        alunos: [],
        treinosBase: [],
        sugestoesExercicio: []
      },
      portfolio: {
        personais: []
      }
    };
  }

  function migrarDeV1() {
    var brutoV1;
    try {
      brutoV1 = localStorage.getItem(CHAVE_LOCALSTORAGE_V1);
    } catch (e) {
      return null;
    }
    if (!brutoV1) {
      return null;
    }
    try {
      var v1 = JSON.parse(brutoV1);
      if (!v1 || v1.versao !== 1) {
        return null;
      }
      var novo = estadoPadrao();
      novo.academia.nome = v1.academia.nome || novo.academia.nome;
      novo.academia.exerciciosNaoOferecidos = v1.academia.exerciciosNaoOferecidos || [];
      novo.personal.nome = v1.personal.nome || novo.personal.nome;
      novo.portfolio = v1.portfolio || novo.portfolio;
      // Alunos antigos (só nome + treino simples) viram alunos "incompletos" —
      // continuam aparecendo, só sem os campos novos preenchidos ainda.
      ["academia", "personal"].forEach(function (tipoConta) {
        var alunosAntigos = (v1[tipoConta] && v1[tipoConta].alunos) || [];
        alunosAntigos.forEach(function (a) {
          var alunoNovo = criarEsqueletoAluno(novo, tipoConta, a.nome || "Aluno sem nome");
          alunoNovo.criadoEm = a.criadoEm || Date.now();
          alunoNovo.treino.exercicios = a.treino || [];
          novo[tipoConta].alunos.push(alunoNovo);
        });
      });
      return novo;
    } catch (e) {
      return null;
    }
  }

  function carregarEstado() {
    var bruto;
    try {
      bruto = localStorage.getItem(CHAVE_LOCALSTORAGE);
    } catch (e) {
      return estadoPadrao();
    }
    if (!bruto) {
      var migrado = migrarDeV1();
      if (migrado) {
        salvarEstado(migrado);
        return migrado;
      }
      return estadoPadrao();
    }
    try {
      var estado = JSON.parse(bruto);
      if (!estado || estado.versao !== 2) {
        return estadoPadrao();
      }
      if (!estado.portfolio) {
        estado.portfolio = { personais: [] };
      }
      ["academia", "personal"].forEach(function (tipoConta) {
        if (!estado[tipoConta].treinosBase) estado[tipoConta].treinosBase = [];
        if (!estado[tipoConta].sugestoesExercicio) estado[tipoConta].sugestoesExercicio = [];
      });
      if (!estado.proximoIdAluno) estado.proximoIdAluno = 1;
      return estado;
    } catch (e) {
      return estadoPadrao();
    }
  }

  function salvarEstado(estado) {
    try {
      localStorage.setItem(CHAVE_LOCALSTORAGE, JSON.stringify(estado));
    } catch (e) {
      // Sem storage disponível — a sessão de teste atual continua funcionando
      // em memória, só não sobrevive a um recarregamento da página.
    }
  }

  function gerarId(prefixo) {
    return prefixo + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function gerarIdAlunoLegivel(estado) {
    var n = estado.proximoIdAluno || 1;
    estado.proximoIdAluno = n + 1;
    return "FF" + String(n).padStart(5, "0");
  }

  function hojeISO() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function encontrarAluno(estado, tipoConta, idAluno) {
    var alunos = estado[tipoConta].alunos || [];
    for (var i = 0; i < alunos.length; i++) {
      if (alunos[i].id === idAluno) {
        return alunos[i];
      }
    }
    return null;
  }

  function criarEsqueletoAluno(estado, tipoConta, nome) {
    return {
      id: gerarIdAlunoLegivel(estado),
      tipoContaOrigem: tipoConta,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
      // Identificação
      nome: (nome || "").trim(),
      dataNascimento: "",
      cpf: "",
      rg: "",
      sexo: "",
      email: "",
      telefone: "",
      endereco: { cep: "", rua: "", numero: "", bairro: "", cidade: "" },
      contatoEmergenciaNome: "",
      contatoEmergenciaTelefone: "",
      // Observação livre — acesso exclusivo de quem cadastrou o aluno.
      // Hoje a "conta" é só Academia OU Personal (login ainda cosmético,
      // sem usuário individual — ver P24/A8 do STATUS.md), então a
      // exclusividade é aplicada no nível de tipoContaOrigem: só o
      // painel do mesmo tipo que cadastrou o aluno mostra/edita este
      // campo. Quando entrar autenticação real, isso pode ficar restrito
      // à pessoa exata que cadastrou, não só ao tipo de conta.
      observacao: "",
      // Contrato / financeiro
      contrato: {
        plano: "",
        formaPagamento: "",
        dataInicio: "",
        termoResponsabilidade: false,
        atestadoMedico: false // só relevante pro Personal
      },
      // Anamnese (campos usados variam por tipoContaOrigem — ver formulário)
      anamnese: {
        objetivo: "",
        nivelExperiencia: "",
        frequenciaSemanalDesejada: "",
        historicoAtividade: "",
        doencas: "",
        lesoes: "",
        medicamentos: "",
        restricoesMedicas: "",
        gestacaoPosParto: "",
        habitos: ""
      },
      // Avaliação física
      avaliacaoFisica: {
        medicoes: [], // { data, altura, peso, percentualGordura, abdomen, quadril, peito, braco, coxa }
        testesFisicos: "",
        temFoto: false
      },
      // Contato complementar (Personal, opcional)
      profissao: "",
      redesSociais: "",
      preferenciaHorario: "",
      // Dias de treino
      diasTreino: {
        comAcademia: [], // dias da semana treinando na academia (tipoContaOrigem academia)
        presencialComPersonal: [], // dias presenciais com o personal
        soApp: [] // dias sem presença, só com o app
      },
      // Treino
      treino: {
        modo: "nenhum", // 'nenhum' | 'base' | 'personalizado'
        baseId: null,
        exercicios: [],
        config: { tipoDivisao: "", tempoMinutos: 60, series: 3, descanso: 60 },
        atualizadoEm: null
      }
    };
  }

  // ---------------------------------------------------------------
  // Motor de pré-preenchimento — grupos/subgrupos por tipo/dia/sexo,
  // fielmente transcritos da seção 6 de RESUMO_TREINOS_PARA_SITE.md
  // (fase ouro, treino nº1 — única fase que o site mostra, decisão de
  // Murilo). Cada slot é [grupo, subgrupo-preferido-ou-null].
  // ---------------------------------------------------------------

  var SLOTS_TREINO = {
    full_body: {
      nome: "Full Body",
      dias: [
        {
          codigo: "unico", nome: "Dia único",
          slots: {
            masculino: [["Costas", "Remada", "Remada_baixa_sentado"], ["Quadríceps", null, "Cadeira_extensora"], ["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Abdômen", "Superior", "Abdominal_tradicional_no_solo"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Abdômen", "Superior", "Abdominal_tradicional_no_solo"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Adutores", null, "Cadeira_adutora"]],
          }
        }
      ]
    },
    upper_lower: {
      nome: "AB (Superior/Inferior)",
      dias: [
        {
          codigo: "A", nome: "Dia A (Superior)",
          slots: {
            masculino: [["Costas", "Remada", "Remada_baixa_sentado"], ["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Costas", "Puxada", "Puxada_frontal_aberta"], ["Peito", "Média", "Voador_Peck_deck"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
            feminino: [["Costas", "Remada", "Remada_baixa_sentado"], ["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Costas", "Puxada", "Puxada_frontal_aberta"], ["Peito", "Média", "Voador_Peck_deck"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
          }
        },
        {
          codigo: "B", nome: "Dia B (Inferior)",
          slots: {
            masculino: [["Quadríceps", null, "Cadeira_extensora"], ["Abdômen", "Médio", "Prancha_plank"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Oblíquos", null, "Torcao_russa"], ["Adutores", null, "Cadeira_adutora"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Quadríceps", null, "Leg_press_45"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Abdômen", "Médio", "Prancha_plank"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Oblíquos", null, "Torcao_russa"], ["Adutores", null, "Cadeira_adutora"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Quadríceps", null, "Leg_press_45"]],
          }
        }
      ]
    },
    abc: {
      nome: "ABC (Push/Pull/Legs)",
      dias: [
        {
          codigo: "A", nome: "Dia A (Push)",
          slots: {
            masculino: [["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Peito", "Média", "Voador_Peck_deck"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"]],
            feminino: [["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Peito", "Média", "Voador_Peck_deck"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"]],
          }
        },
        {
          codigo: "B", nome: "Dia B (Pull)",
          slots: {
            masculino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_com_barra_V"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
            feminino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_com_barra_V"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
          }
        },
        {
          codigo: "C", nome: "Dia C (Pernas + Core)",
          slots: {
            masculino: [["Quadríceps", null, "Cadeira_extensora"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Abdômen", "Inferior", "Reverse_crunch_no_solo"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Oblíquos", null, "Torcao_russa"], ["Quadríceps", null, "Leg_press_45"], ["Posteriores de coxa", null, "Mesa_flexora_deitado"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Abdômen", "Inferior", "Reverse_crunch_no_solo"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Oblíquos", null, "Torcao_russa"], ["Quadríceps", null, "Leg_press_45"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"]],
          }
        }
      ]
    },
    abcde: {
      nome: "ABCDE",
      dias: [
        {
          codigo: "A", nome: "Dia A (Peito+Tríceps)",
          slots: {
            masculino: [["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Peito", "Média", "Voador_Peck_deck"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"], ["Peito", "Superior", "Supino_inclinado_na_maquina_Hammer"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_com_corda"], ["Peito", "Média", "Supino_reto_na_maquina"]],
            feminino: [["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Peito", "Média", "Voador_Peck_deck"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"], ["Peito", "Superior", "Supino_inclinado_na_maquina_Hammer"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_com_corda"], ["Peito", "Média", "Supino_reto_na_maquina"]],
          }
        },
        {
          codigo: "B", nome: "Dia B (Costas+Bíceps)",
          slots: {
            masculino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_com_barra_V"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Costas", "Remada", "Remada_maquina_Hammer"], ["Bíceps", "Braquial", "Rosca_martelo_na_polia_corda"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
            feminino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_com_barra_V"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Costas", "Remada", "Remada_maquina_Hammer"], ["Bíceps", "Braquial", "Rosca_martelo_na_polia_corda"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
          }
        },
        {
          codigo: "C", nome: "Dia C (Pernas completas)",
          slots: {
            masculino: [["Quadríceps", null, "Cadeira_extensora"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Quadríceps", null, "Leg_press_45"], ["Posteriores de coxa", null, "Mesa_flexora_deitado"], ["Panturrilha", null, "Panturrilha_em_pe_no_Smith"], ["Adutores", null, "Agachamento_Sumo_na_Maquina"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Quadríceps", null, "Leg_press_45"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Posteriores de coxa", null, "Mesa_flexora_deitado"], ["Panturrilha", null, "Panturrilha_em_pe_no_Smith"]],
          }
        },
        {
          codigo: "D", nome: "Dia D (Ombros+Trapézio+Core)",
          slots: {
            masculino: [["Abdômen", "Superior", "Abdominal_tradicional_no_solo"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Oblíquos", null, "Torcao_russa"], ["Abdômen", "Médio", "Prancha_plank"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"], ["Lombar", null, "Super_homem_com_remada"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"]],
            feminino: [["Abdômen", "Superior", "Abdominal_tradicional_no_solo"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Oblíquos", null, "Torcao_russa"], ["Abdômen", "Médio", "Prancha_plank"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"], ["Lombar", null, "Super_homem_com_remada"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"]],
          }
        },
        {
          codigo: "E", nome: "Dia E (Especialização por sexo)",
          slots: {
            masculino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Peito", "Média", "Voador_Peck_deck"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Quadríceps", null, "Leg_press_45"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Posteriores de coxa", null, "Mesa_flexora_deitado"], ["Panturrilha", null, "Panturrilha_em_pe_no_Smith"]],
          }
        }
      ]
    },
    pplul: {
      nome: "ABC P SI (Push/Pull/Legs + Superior/Inferior)",
      dias: [
        {
          codigo: "A", nome: "Dia A (Push - Seg)",
          slots: {
            masculino: [["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Peito", "Média", "Voador_Peck_deck"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"]],
            feminino: [["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Ombros", "Posterior", "crucifixo_inverso_na_maquina"], ["Tríceps", "Pulley — empurrando para baixo", "Triceps_pulley_barra_V"], ["Peito", "Média", "Voador_Peck_deck"], ["Ombros", "Lateral", "Elevacao_lateral_com_halteres"], ["Tríceps", "Testa — empurrando para frente", "Triceps_testa_com_barra_na_polia_alta"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"]],
          }
        },
        {
          codigo: "B", nome: "Dia B (Pull - Ter)",
          slots: {
            masculino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_com_barra_V"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Costas", "Remada", "Remada_maquina_Hammer"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
            feminino: [["Costas", "Puxada", "Puxada_frontal_aberta"], ["Bíceps", "Braquial", "Rosca_martelo_com_halteres"], ["Costas", "Remada", "Remada_baixa_sentado"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_com_barra_V"], ["Bíceps", "Cabeça longa", "Rosca_inclinada_com_halteres_duplos"], ["Costas", "Remada", "Remada_maquina_Hammer"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
          }
        },
        {
          codigo: "C", nome: "Dia C (Legs - Qua)",
          slots: {
            masculino: [["Quadríceps", null, "Cadeira_extensora"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Quadríceps", null, "Leg_press_45"], ["Posteriores de coxa", null, "Mesa_flexora_deitado"], ["Panturrilha", null, "Panturrilha_em_pe_no_Smith"], ["Adutores", null, "Agachamento_Sumo_na_Maquina"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Glúteos", "Glúteo máximo", "Elevacao_pelvica_na_maquina"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Quadríceps", null, "Leg_press_45"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Posteriores de coxa", null, "Mesa_flexora_deitado"], ["Panturrilha", null, "Panturrilha_em_pe_no_Smith"]],
          }
        },
        {
          codigo: "S", nome: "Dia S (Superior - Sex)",
          slots: {
            masculino: [["Costas", "Remada", "Remada_baixa_sentado"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"], ["Costas", "Puxada", "Puxada_frontal_aberta"], ["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
            feminino: [["Costas", "Remada", "Remada_baixa_sentado"], ["Peito", "Inferior", "Supino_declinado_na_maquina_Hammer"], ["Ombros", "Superior", "Desenvolvimento_na_maquina"], ["Tríceps", "Francês — empurrando para cima", "Triceps_frances_com_barra_reta"], ["Bíceps", "Cabeça curta", "Rosca_scott_na_maquina"], ["Costas", "Puxada", "Puxada_frontal_aberta"], ["Peito", "Superior", "Supino_inclinado_com_halteres"], ["Trapézio", null, "Encolhimento_de_trapezio_com_halteres"], ["Antebraço", null, "Flexao_do_punho_com_barra_W"]],
          }
        },
        {
          codigo: "I", nome: "Dia I (Inferior - Sáb)",
          slots: {
            masculino: [["Quadríceps", null, "Cadeira_extensora"], ["Abdômen", "Médio", "Prancha_plank"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Oblíquos", null, "Torcao_russa"], ["Adutores", null, "Cadeira_adutora"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Quadríceps", null, "Leg_press_45"]],
            feminino: [["Quadríceps", null, "Cadeira_extensora"], ["Abdômen", "Médio", "Prancha_plank"], ["Glúteos", "Glúteo médio e mínimo", "Cadeira_abdutora"], ["Posteriores de coxa", null, "Cadeira_flexora_sentado"], ["Oblíquos", null, "Torcao_russa"], ["Panturrilha", null, "Panturrilha_em_pe_na_maquina"], ["Adutores", null, "Cadeira_adutora"], ["Lombar", null, "Extensao_do_tronco_hiperextensao"], ["Quadríceps", null, "Leg_press_45"]],
          }
        }
      ]
    }
  };

  // Valores aceitos (seção 1 de RESUMO_TREINOS_PARA_SITE.md) — usar
  // exatamente esta lista no site, não inventar outra.
  var TEMPOS_MINUTOS = [30, 40, 50, 60, 70, 80, 90, 105, 120, 150, 180];
  var SERIES_OPCOES = [2, 3, 4, 5];
  var DESCANSO_OPCOES = [30, 45, 60, 90, 180, 240, 300];
  var SERIES_PADRAO = 3;
  var DESCANSO_PADRAO = 60;

  function calcularQuantidadeExercicios(tempoMinutos, series, descanso) {
    var tempoPorExercicio = series * (70 + descanso);
    var qtd = Math.floor((tempoMinutos * 60) / tempoPorExercicio);
    return Math.max(1, qtd);
  }

  // D035 (2026-09-29): escolhe pelo ID EXATO que o motor do app entrega
  // (vindo de RESUMO_TREINOS_PARA_SITE.md seção 6 / MAPA_ID_MOTOR_PARA_
  // CATALOGO_190.json, ambos da Lógica e Testes) — só usa se o exercício
  // ainda existir no catálogo disponível (a academia pode ter desmarcado
  // o aparelho) e ainda não tiver sido usado neste treino.
  function escolherExercicioExato(catalogoDisponivel, usados, idExato) {
    if (!idExato) return null;
    if (usados.indexOf(idExato) !== -1) return null;
    var achado = catalogoDisponivel.filter(function (ex) {
      return ex.id === idExato;
    })[0];
    return achado || null;
  }

  // Escolhe, dentro do catálogo disponível, um exercício do grupo (e
  // subgrupo, se houver e existir) ainda não usado neste treino. Usada
  // como reserva quando o ID exato (acima) não está disponível.
  function escolherExercicio(catalogoDisponivel, usados, grupo, subgrupo) {
    var candidatos = catalogoDisponivel.filter(function (ex) {
      return ex.grupo === grupo && usados.indexOf(ex.id) === -1;
    });
    if (subgrupo) {
      var comSubgrupo = candidatos.filter(function (ex) {
        return ex.subgrupo === subgrupo;
      });
      if (comSubgrupo.length > 0) {
        candidatos = comSubgrupo;
      }
    }
    return candidatos.length > 0 ? candidatos[0] : null;
  }

  // ---------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------

  var DadosDemo = {};

  DadosDemo.urlDaImagem = urlDaImagem;
  DadosDemo.TEMPOS_MINUTOS = TEMPOS_MINUTOS;
  DadosDemo.SERIES_OPCOES = SERIES_OPCOES;
  DadosDemo.DESCANSO_OPCOES = DESCANSO_OPCOES;
  DadosDemo.SERIES_PADRAO = SERIES_PADRAO;
  DadosDemo.DESCANSO_PADRAO = DESCANSO_PADRAO;
  DadosDemo.MAX_TREINOS_BASE = MAX_TREINOS_BASE;

  DadosDemo.listarTiposTreino = function () {
    return Object.keys(SLOTS_TREINO).map(function (chave) {
      return { chave: chave, nome: SLOTS_TREINO[chave].nome };
    });
  };

  DadosDemo.listarDiasDoTipo = function (tipoDivisao) {
    var tipo = SLOTS_TREINO[tipoDivisao];
    if (!tipo) return [];
    return tipo.dias.map(function (d) {
      return { codigo: d.codigo, nome: d.nome };
    });
  };

  DadosDemo.listarCatalogo = function () {
    return carregarCatalogo();
  };

  DadosDemo.listarGrupos = function () {
    return carregarCatalogo().then(function (lista) {
      var grupos = [];
      lista.forEach(function (ex) {
        if (grupos.indexOf(ex.grupo) === -1) {
          grupos.push(ex.grupo);
        }
      });
      grupos.sort();
      return grupos;
    });
  };

  DadosDemo.listarExerciciosDisponiveis = function (tipoConta) {
    return carregarCatalogo().then(function (lista) {
      if (tipoConta !== "academia") {
        return lista;
      }
      var estado = carregarEstado();
      var excluidos = estado.academia.exerciciosNaoOferecidos || [];
      if (excluidos.length === 0) {
        return lista;
      }
      return lista.filter(function (ex) {
        return excluidos.indexOf(ex.id) === -1;
      });
    });
  };

  DadosDemo.exercicioEstaOferecido = function (idExercicio) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    return excluidos.indexOf(idExercicio) === -1;
  };

  DadosDemo.alternarExercicioOferecido = function (idExercicio) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    var pos = excluidos.indexOf(idExercicio);
    if (pos === -1) {
      excluidos.push(idExercicio);
    } else {
      excluidos.splice(pos, 1);
    }
    estado.academia.exerciciosNaoOferecidos = excluidos;
    salvarEstado(estado);
    return excluidos.indexOf(idExercicio) === -1;
  };

  DadosDemo.contarOferecidos = function (totalCatalogo) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    return totalCatalogo - excluidos.length;
  };

  // --- Alunos (cadastro completo, 2026-09-29) ---

  DadosDemo.listarAlunos = function (tipoConta, termo) {
    var estado = carregarEstado();
    var alunos = estado[tipoConta].alunos || [];
    if (termo) {
      var t = termo.trim().toLowerCase();
      var tDigitos = t.replace(/\D/g, "");
      alunos = alunos.filter(function (a) {
        if (a.nome.toLowerCase().indexOf(t) !== -1) return true;
        if (a.id.toLowerCase().indexOf(t) !== -1) return true;
        if (tDigitos && (a.cpf || "").replace(/\D/g, "").indexOf(tDigitos) !== -1) return true;
        if (tDigitos && (a.telefone || "").replace(/\D/g, "").indexOf(tDigitos) !== -1) return true;
        return false;
      });
    }
    return alunos.slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  // dados = objeto com todos os campos do formulário (ver parceiro.html).
  // Campos não enviados ficam com o valor padrão do esqueleto.
  DadosDemo.cadastrarAluno = function (tipoConta, dados) {
    var nomeLimpo = ((dados && dados.nome) || "").trim();
    if (!nomeLimpo) {
      throw new Error("Nome do aluno não pode ficar em branco.");
    }
    var estado = carregarEstado();
    var aluno = criarEsqueletoAluno(estado, tipoConta, nomeLimpo);
    aplicarCamposAluno(aluno, dados);
    estado[tipoConta].alunos.push(aluno);
    salvarEstado(estado);
    return aluno;
  };

  DadosDemo.atualizarAluno = function (tipoConta, idAluno, dados) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) {
      throw new Error("Aluno não encontrado.");
    }
    aplicarCamposAluno(aluno, dados);
    aluno.atualizadoEm = Date.now();
    salvarEstado(estado);
    return aluno;
  };

  function aplicarCamposAluno(aluno, dados) {
    if (!dados) return;
    var camposDiretos = ["nome", "dataNascimento", "cpf", "rg", "sexo", "email", "telefone",
      "contatoEmergenciaNome", "contatoEmergenciaTelefone", "profissao", "redesSociais", "preferenciaHorario",
      "observacao"];
    camposDiretos.forEach(function (campo) {
      if (dados[campo] !== undefined) {
        aluno[campo] = (dados[campo] || "").toString().trim();
      }
    });
    if (dados.endereco) {
      Object.keys(aluno.endereco).forEach(function (k) {
        if (dados.endereco[k] !== undefined) aluno.endereco[k] = (dados.endereco[k] || "").trim();
      });
    }
    if (dados.contrato) {
      Object.keys(aluno.contrato).forEach(function (k) {
        if (dados.contrato[k] !== undefined) aluno.contrato[k] = dados.contrato[k];
      });
    }
    if (dados.anamnese) {
      Object.keys(aluno.anamnese).forEach(function (k) {
        if (dados.anamnese[k] !== undefined) aluno.anamnese[k] = (dados.anamnese[k] || "").toString().trim();
      });
    }
    if (dados.avaliacaoFisica) {
      if (dados.avaliacaoFisica.testesFisicos !== undefined) {
        aluno.avaliacaoFisica.testesFisicos = dados.avaliacaoFisica.testesFisicos;
      }
      if (dados.avaliacaoFisica.temFoto !== undefined) {
        aluno.avaliacaoFisica.temFoto = !!dados.avaliacaoFisica.temFoto;
      }
    }
    if (dados.diasTreino) {
      Object.keys(aluno.diasTreino).forEach(function (k) {
        if (dados.diasTreino[k] !== undefined) aluno.diasTreino[k] = dados.diasTreino[k];
      });
    }
  }

  DadosDemo.adicionarMedicao = function (tipoConta, idAluno, medicao) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) {
      throw new Error("Aluno não encontrado.");
    }
    var registro = {
      data: (medicao && medicao.data) || hojeISO(),
      altura: (medicao && medicao.altura) || "",
      peso: (medicao && medicao.peso) || "",
      percentualGordura: (medicao && medicao.percentualGordura) || "",
      abdomen: (medicao && medicao.abdomen) || "",
      quadril: (medicao && medicao.quadril) || "",
      peito: (medicao && medicao.peito) || "",
      braco: (medicao && medicao.braco) || "",
      coxa: (medicao && medicao.coxa) || ""
    };
    aluno.avaliacaoFisica.medicoes.push(registro);
    aluno.atualizadoEm = Date.now();
    salvarEstado(estado);
    return registro;
  };

  // Peso inicial/atual — usados pelo cartão de Montar Treino.
  DadosDemo.pesoInicialEAtual = function (aluno) {
    var medicoes = (aluno.avaliacaoFisica && aluno.avaliacaoFisica.medicoes) || [];
    if (medicoes.length === 0) {
      return { inicial: null, atual: null };
    }
    var ordenadas = medicoes.slice().sort(function (a, b) {
      return a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
    });
    return {
      inicial: ordenadas[0].peso || null,
      atual: ordenadas[ordenadas.length - 1].peso || null
    };
  };

  DadosDemo.calcularIdade = function (dataNascimentoISO) {
    if (!dataNascimentoISO) return null;
    var nasc = new Date(dataNascimentoISO);
    if (isNaN(nasc.getTime())) return null;
    var hoje = new Date();
    var idade = hoje.getFullYear() - nasc.getFullYear();
    var m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) {
      idade--;
    }
    return idade;
  };

  // Algoritmo padrão de dígito verificador do CPF — client-side, sem
  // depender de nenhuma API. Retorna true só se os 11 dígitos batem
  // com as duas checagens (não aceita sequências tipo "111.111.111-11").
  DadosDemo.validarCPF = function (cpf) {
    var digitos = String(cpf || "").replace(/\D/g, "");
    if (digitos.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(digitos)) return false;
    function digitoVerificador(base, pesoInicial) {
      var soma = 0;
      for (var i = 0; i < base.length; i++) {
        soma += parseInt(base.charAt(i), 10) * (pesoInicial - i);
      }
      var resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    }
    var d1 = digitoVerificador(digitos.substring(0, 9), 10);
    if (d1 !== parseInt(digitos.charAt(9), 10)) return false;
    var d2 = digitoVerificador(digitos.substring(0, 10), 11);
    if (d2 !== parseInt(digitos.charAt(10), 10)) return false;
    return true;
  };

  // Máscara progressiva "000.000.000-00", usada enquanto o usuário digita.
  DadosDemo.formatarCPF = function (valor) {
    var d = String(valor || "").replace(/\D/g, "").slice(0, 11);
    var saida = d.slice(0, 3);
    if (d.length > 3) saida += "." + d.slice(3, 6);
    if (d.length > 6) saida += "." + d.slice(6, 9);
    if (d.length > 9) saida += "-" + d.slice(9, 11);
    return saida;
  };

  // Máscara progressiva "(DD) 9XXXX-XXXX" (só a parte nacional — o
  // "+55" é um prefixo fixo fora do campo, ver parceiro.html), usada
  // enquanto o usuário digita telefone ou telefone de emergência.
  // Também aceita colar o número já com "+55"/"55" na frente (nesse
  // caso descarta o código de país colado, já que ele é mostrado à
  // parte).
  DadosDemo.formatarTelefoneBR = function (valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.indexOf("55") === 0 && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    var ddd = d.slice(0, 2);
    var numero = d.slice(2);
    var saida = "";
    if (ddd.length > 0) saida += "(" + ddd + (ddd.length === 2 ? ")" : "");
    if (numero.length > 0) saida += " " + numero.slice(0, 5);
    if (numero.length > 5) saida += "-" + numero.slice(5, 9);
    return saida;
  };

  // true só quando DDD (2 dígitos) + número (9 dígitos) estão completos.
  DadosDemo.telefoneEstaCompleto = function (valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.indexOf("55") === 0 && d.length > 11) d = d.slice(2);
    return d.length === 11;
  };

  // Autofill de endereço a partir do CEP — usa o ViaCEP (viacep.com.br),
  // serviço público de terceiros, gratuito, sem chave/cadastro (a API
  // oficial dos Correios exige contrato comercial pago — verificado em
  // 2026-09-29, não é uma opção viável aqui). Nunca lança erro: se o CEP
  // não existir ou a rede falhar, resolve com null e o formulário
  // continua 100% preenchível à mão — autofill é sempre um "a mais",
  // nunca um bloqueio.
  DadosDemo.consultarCEP = function (cep) {
    var digitos = String(cep || "").replace(/\D/g, "");
    if (digitos.length !== 8) {
      return Promise.resolve(null);
    }
    return fetch("https://viacep.com.br/ws/" + digitos + "/json/")
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (dados) {
        if (!dados || dados.erro) return null;
        return {
          rua: dados.logradouro || "",
          bairro: dados.bairro || "",
          cidade: dados.localidade || ""
        };
      })
      .catch(function () {
        return null;
      });
  };

  DadosDemo.removerAluno = function (tipoConta, idAluno) {
    var estado = carregarEstado();
    estado[tipoConta].alunos = estado[tipoConta].alunos.filter(function (a) {
      return a.id !== idAluno;
    });
    salvarEstado(estado);
  };

  DadosDemo.buscarAluno = function (tipoConta, idAluno) {
    var estado = carregarEstado();
    return encontrarAluno(estado, tipoConta, idAluno);
  };

  // --- Treino ---

  DadosDemo.adicionarExercicioAoTreino = function (tipoConta, idAluno, idExercicio) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) return;
    if (aluno.treino.exercicios.indexOf(idExercicio) === -1) {
      aluno.treino.exercicios.push(idExercicio);
    }
    // Editar depois de aplicar uma base transforma em personalizado —
    // a base salva na biblioteca do profissional não é tocada (pedido
    // literal de Murilo: "alterar o base não muda, apenas vira personalizado").
    if (aluno.treino.modo === "base") {
      aluno.treino.modo = "personalizado";
    } else if (aluno.treino.modo === "nenhum") {
      aluno.treino.modo = "personalizado";
    }
    aluno.treino.atualizadoEm = Date.now();
    salvarEstado(estado);
  };

  DadosDemo.removerExercicioDoTreino = function (tipoConta, idAluno, idExercicio) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) return;
    aluno.treino.exercicios = aluno.treino.exercicios.filter(function (id) {
      return id !== idExercicio;
    });
    if (aluno.treino.modo === "base") {
      aluno.treino.modo = "personalizado";
    }
    aluno.treino.atualizadoEm = Date.now();
    salvarEstado(estado);
  };

  // Gera o treino pré-definido (tipo de divisão + dia + tempo/série/descanso)
  // a partir do catálogo do PRÓPRIO site — ver aviso no topo do arquivo
  // sobre a diferença em relação ao catálogo do app.
  DadosDemo.gerarTreinoPreDefinido = function (tipoConta, idAluno, opcoes) {
    return DadosDemo.listarExerciciosDisponiveis(tipoConta).then(function (catalogo) {
      var tipo = SLOTS_TREINO[opcoes.tipoDivisao];
      if (!tipo) {
        throw new Error("Tipo de treino desconhecido: " + opcoes.tipoDivisao);
      }
      var dia = tipo.dias.filter(function (d) { return d.codigo === opcoes.diaCodigo; })[0];
      if (!dia) {
        throw new Error("Dia \"" + opcoes.diaCodigo + "\" não existe no tipo \"" + opcoes.tipoDivisao + "\". Use DadosDemo.listarDiasDoTipo() para pegar os códigos válidos.");
      }
      var sexo = opcoes.sexo === "feminino" ? "feminino" : "masculino";
      var slotsBase = dia.slots[sexo];
      var series = opcoes.series || SERIES_PADRAO;
      var descanso = opcoes.descanso || DESCANSO_PADRAO;
      var tempoMinutos = opcoes.tempoMinutos || 60;
      var qtd = calcularQuantidadeExercicios(tempoMinutos, series, descanso);

      // Monta a lista de slots-alvo: até 9 vem direto da referência
      // (já ordenada por prioridade); além de 9, repete a mesma ordem de
      // prioridade numa 2ª volta, pulando grupos travados em 1 (Trapézio,
      // Antebraço, e os de core: Abdômen/Oblíquos/Lombar).
      var GRUPOS_TRAVADOS_EM_1 = ["Trapézio", "Antebraço", "Abdômen", "Oblíquos", "Lombar"];
      var slotsAlvo = slotsBase.slice(0, Math.min(qtd, slotsBase.length));
      if (qtd > slotsBase.length) {
        var faltam = qtd - slotsBase.length;
        var segundaVolta = slotsBase.filter(function (s) {
          return GRUPOS_TRAVADOS_EM_1.indexOf(s[0]) === -1;
        });
        for (var v = 0; v < faltam && segundaVolta.length > 0; v++) {
          slotsAlvo.push(segundaVolta[v % segundaVolta.length]);
        }
      }

      var usados = [];
      var exerciciosEscolhidos = [];
      var gruposNaoEncontrados = [];
      var quantidadeExata = 0;
      var quantidadeSubstituida = 0;
      slotsAlvo.forEach(function (slot) {
        // slot = [grupo, subgrupo, idExato] — idExato vem direto do
        // exemplo real do motor do app (D035). Tenta o exato primeiro;
        // só cai para grupo/subgrupo se ele não estiver disponível
        // (aparelho excluído pela academia, ou já usado — 2ª volta).
        var ex = escolherExercicioExato(catalogo, usados, slot[2]);
        if (ex) {
          quantidadeExata++;
        } else {
          ex = escolherExercicio(catalogo, usados, slot[0], slot[1]);
          if (!ex) {
            // catálogo da academia pode ter excluído tudo daquele grupo —
            // tenta de novo sem exigir o subgrupo específico.
            ex = escolherExercicio(catalogo, usados, slot[0], null);
          }
          if (ex) {
            quantidadeSubstituida++;
          }
        }
        if (ex) {
          usados.push(ex.id);
          exerciciosEscolhidos.push(ex.id);
        } else {
          gruposNaoEncontrados.push(slot[0]);
        }
      });

      var estado = carregarEstado();
      var aluno = encontrarAluno(estado, tipoConta, idAluno);
      if (!aluno) {
        throw new Error("Aluno não encontrado.");
      }
      aluno.treino.modo = "personalizado";
      aluno.treino.baseId = null;
      aluno.treino.exercicios = exerciciosEscolhidos;
      aluno.treino.config = { tipoDivisao: opcoes.tipoDivisao, diaCodigo: dia.codigo, tempoMinutos: tempoMinutos, series: series, descanso: descanso };
      aluno.treino.atualizadoEm = Date.now();
      salvarEstado(estado);

      return { aluno: aluno, quantidadeAlvo: qtd, gruposNaoEncontrados: gruposNaoEncontrados, quantidadeExata: quantidadeExata, quantidadeSubstituida: quantidadeSubstituida };
    });
  };

  // --- Treinos-base (biblioteca do profissional, até 20) ---

  DadosDemo.listarTreinosBase = function (tipoConta) {
    var estado = carregarEstado();
    return (estado[tipoConta].treinosBase || []).slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  DadosDemo.salvarTreinoBase = function (tipoConta, nome, exercicios) {
    var nomeLimpo = (nome || "").trim();
    if (!nomeLimpo) {
      throw new Error("Dê um nome para o treino-base (ex: \"Base iniciante\").");
    }
    var estado = carregarEstado();
    var lista = estado[tipoConta].treinosBase || [];
    if (lista.length >= MAX_TREINOS_BASE) {
      throw new Error("Limite de " + MAX_TREINOS_BASE + " treinos-base atingido. Apague algum antes de salvar um novo.");
    }
    var base = {
      id: gerarId("base"),
      nome: nomeLimpo,
      exercicios: (exercicios || []).slice(),
      criadoEm: Date.now()
    };
    lista.push(base);
    estado[tipoConta].treinosBase = lista;
    salvarEstado(estado);
    return base;
  };

  DadosDemo.removerTreinoBase = function (tipoConta, idBase) {
    var estado = carregarEstado();
    estado[tipoConta].treinosBase = (estado[tipoConta].treinosBase || []).filter(function (b) {
      return b.id !== idBase;
    });
    salvarEstado(estado);
  };

  // Aplica uma base ao aluno. Fica marcado modo:'base' até a primeira
  // edição (adicionar/remover exercício), quando vira 'personalizado' —
  // a base em si, na biblioteca, nunca é alterada por isso.
  DadosDemo.aplicarTreinoBaseNoAluno = function (tipoConta, idAluno, idBase) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    var base = (estado[tipoConta].treinosBase || []).filter(function (b) { return b.id === idBase; })[0];
    if (!aluno || !base) {
      throw new Error("Aluno ou treino-base não encontrado.");
    }
    aluno.treino.modo = "base";
    aluno.treino.baseId = base.id;
    aluno.treino.exercicios = base.exercicios.slice();
    aluno.treino.atualizadoEm = Date.now();
    salvarEstado(estado);
    return aluno;
  };

  // --- Sugestão de exercício (revisão em 48h, implantação em até 7 dias
  //     se aprovado — pedido literal de Murilo, 2026-09-29). Fica
  //     registrado localmente como "em análise"; não existe hoje um
  //     backend/fila real de revisão — ver STATUS.md. ---

  DadosDemo.sugerirExercicio = function (tipoConta, dados) {
    var nomeLimpo = ((dados && dados.nomeExercicio) || "").trim();
    if (!nomeLimpo) {
      throw new Error("Descreva o exercício que você quer sugerir.");
    }
    var estado = carregarEstado();
    var agora = Date.now();
    var registro = {
      id: gerarId("sugestao"),
      nomeExercicio: nomeLimpo,
      grupoMuscular: ((dados && dados.grupoMuscular) || "").trim(),
      observacao: ((dados && dados.observacao) || "").trim(),
      dataEnvio: agora,
      previsaoAnaliseAte: agora + 48 * 60 * 60 * 1000,
      previsaoImplantacaoAte: agora + 7 * 24 * 60 * 60 * 1000,
      status: "em análise"
    };
    estado[tipoConta].sugestoesExercicio.push(registro);
    salvarEstado(estado);
    return registro;
  };

  DadosDemo.listarSugestoesExercicio = function (tipoConta) {
    var estado = carregarEstado();
    return (estado[tipoConta].sugestoesExercicio || []).slice().sort(function (a, b) {
      return b.dataEnvio - a.dataEnvio;
    });
  };

  // --- Portfólio de parceiros (cadastros de personal recebidos) ---

  DadosDemo.cadastrarPersonalPendente = function (dados) {
    var estado = carregarEstado();
    var registro = {
      id: gerarId("portfolio_personal"),
      criadoEm: Date.now(),
      status: "pendente",
      nome: (dados.nome || "").trim(),
      cref: (dados.cref || "").trim(),
      formacao: (dados.formacao || "").trim(),
      especializacao: (dados.especializacao || "").trim(),
      cidade: (dados.cidade || "").trim(),
      bairro: (dados.bairro || "").trim(),
      experiencias: (dados.experiencias || "").trim(),
      telefone: (dados.telefone || "").trim(),
      email: (dados.email || "").trim(),
      temFoto: !!dados.temFoto
    };
    if (!estado.portfolio) {
      estado.portfolio = { personais: [] };
    }
    estado.portfolio.personais.push(registro);
    salvarEstado(estado);
    return registro;
  };

  DadosDemo.listarPortfolioPersonais = function () {
    var estado = carregarEstado();
    var lista = (estado.portfolio && estado.portfolio.personais) || [];
    return lista.slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  DadosDemo.definirStatusPersonalPortfolio = function (id, status) {
    var estado = carregarEstado();
    var lista = (estado.portfolio && estado.portfolio.personais) || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        lista[i].status = status;
        break;
      }
    }
    salvarEstado(estado);
  };

  global.DadosDemo = DadosDemo;
})(window);
