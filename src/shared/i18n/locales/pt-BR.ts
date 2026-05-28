import { TranslationSchema } from "../types";

const ptBR: TranslationSchema = {
  app: {
    loading: {
      checkingForUpdates: "Verificando atualizacoes...",
      downloadingUpdate: "Baixando atualizacao...",
      initializing: "Inicializando...",
      loadingYouTubeMusic: "Carregando YouTube Music...",
      loadedYouTubeMusic: "YouTube Music carregado",
      initialized: "Inicializado",
      failedToLoadYouTubeMusic: (errorDescription, errorCode) => `Falha ao carregar o YouTube Music: ${errorDescription} (${errorCode})`,
      youTubeMusicLoadTimedOut: "O YouTube Music esta demorando mais que o normal para carregar"
    }
  },
  settings: {
    tabs: {
      general: "Geral",
      appearance: "Aparencia",
      playback: "Reproducao",
      integrations: "Integracoes",
      shortcuts: "Atalhos",
      about: "Sobre"
    },
    general: {
      language: "Idioma",
      hideToTrayOnClose: "Minimizar para a bandeja ao fechar",
      showNotificationOnSongChange: "Mostrar notificacao ao trocar de musica",
      startOnBoot: "Iniciar com o sistema",
      disableHardwareAcceleration: "Desativar aceleracao de hardware"
    },
    appearance: {
      alwaysShowVolumeSlider: "Sempre mostrar controle de volume",
      customCSS: "CSS personalizado",
      customCSSFilePath: "Arquivo CSS personalizado",
      zoom: "Zoom",
      trayIconStyle: "Estilo do icone da bandeja",
      trayIconStyleOptions: {
        auto: "Automatico",
        white: "Branco",
        black: "Preto"
      }
    },
    playback: {
      continueWhereYouLeftOff: "Continuar de onde parou",
      pauseOnApplicationLaunch: "Pausar ao iniciar o aplicativo",
      showTrackProgressOnTaskbar: "Mostrar progresso da faixa na barra de tarefas",
      enableSpeakerFill: "Ativar preenchimento de alto-falantes",
      ratioVolume: "Volume em proporcao"
    },
    integrations: {
      companionServer: "Servidor companion",
      companionServerDisabled: "Esta integracao nao pode ser ativada porque o safeStorage esta indisponivel",
      allowBrowserCommunication: "Permitir comunicacao com o navegador",
      allowBrowserCommunicationDescription: "Esta opcao pode ser perigosa porque permite que qualquer site visitado se comunique com o servidor companion",
      enableCompanionAuthorization: "Ativar autorizacao companion",
      enableCompanionAuthorizationDescription: "Desativa automaticamente apos a primeira autorizacao bem-sucedida ou depois de 5 minutos",
      authorizedCompanions: "Companions autorizados",
      authorizedCompanionsDescription: "Esta e a lista de companions que atualmente tem acesso ao servidor companion",
      companion: "Companion",
      version: "Versao",
      noAuthorizedCompanions: "Nenhum companion autorizado",
      discordRichPresence: "Presenca rica do Discord",
      discordConnectionFailed: "Nao foi possivel conectar ao Discord apos 30 tentativas",
      retry: "Tentar novamente",
      lastFmScrobbling: "Scrobbling do Last.fm",
      lastFmDisabled: "Esta integracao nao pode ser ativada porque o safeStorage esta indisponivel",
      userIsAuthenticated: "Usuario autenticado:",
      yes: "Sim",
      no: "Nao",
      logout: "Sair",
      scrobblePercent: "Percentual de scrobble",
      scrobblePercentDescription: "Define quando uma musica sera enviada ao scrobble"
    },
    shortcuts: {
      playPause: "Reproduzir/Pausar",
      next: "Proxima",
      previous: "Anterior",
      thumbsUp: "Gostei",
      thumbsDown: "Nao gostei",
      increaseVolume: "Aumentar volume",
      decreaseVolume: "Diminuir volume",
      registerError: "Falha ao registrar o atalho. Outro aplicativo ja usa esse atalho?"
    },
    about: {
      madeBy: "Feito pela equipe YTMDesktop",
      checkForUpdates: "Verificar atualizacoes",
      restartToUpdate: "Reiniciar para atualizar",
      checkingForUpdates: "Verificando atualizacoes...",
      downloadingUpdate: "Baixando atualizacao...",
      updateNotAvailable: "Atualizacao indisponivel",
      autoUpdaterDisabled: "Atualizacao automatica desativada",
      version: "Versao",
      branch: "Branch",
      commit: "Commit",
      website: "Site"
    },
    restart: {
      message: "Reinicie o aplicativo para aplicar as alteracoes",
      button: "Reiniciar"
    }
  }
};

export default ptBR;
