# Transmitir

Aplicação web de compartilhamento de tela em tempo real. O navegador do transmissor captura a tela após autorização explícita e envia áudio/vídeo por WebRTC ponto a ponto. Node.js/Express serve a interface e o servidor WebSocket coordena as salas e a negociação; a sinalização não transporta o vídeo.

## Arquitetura

- **Páginas web:** `public/` contém a página inicial, painel do transmissor e tela do espectador.
- **Servidor HTTP:** `server/index.js` publica os arquivos, cria salas, expõe saúde/configuração ICE e emite credenciais TURN temporárias.
- **Sinalização:** `server/signaling/` valida mensagens e encaminha SDP e candidatos ICE somente entre os participantes da mesma sala.
- **Salas e tokens:** `server/rooms/` e `server/security/` mantêm salas na memória, validam participantes, aplicam limites e expiram links.
- **Duração da sala:** enquanto o transmissor permanecer conectado, o servidor envia sinais de manutenção e renova a validade da sala. Não há limite fixo de duração; a sala expira após o período de inatividade configurado em `ROOM_TTL_SECONDS`.
- **Mídia:** `public/js/webrtc/` trata captura, peer connections, qualidade e métricas. Existe uma `RTCPeerConnection` do transmissor por espectador.
- **Qualidade de vídeo:** o app mantém o teto de bitrate do perfil escolhido, não o reduz manualmente quando detecta perda ou latência, e pede ao navegador que preserve a resolução antes da taxa de quadros. O controle de congestionamento nativo do navegador continua ativo e ainda pode reduzir a qualidade se a conexão não comportar o envio.

O cliente escolhe uma fonte pelo seletor do navegador. Depois, host e espectador trocam offer/answer SDP e candidatos ICE pelo WebSocket. ICE tenta selecionar um caminho direto; STUN ajuda a descobrir endereços de conexão e TURN retransmite a mídia quando necessário. Depois de estabelecida, a mídia segue pela conexão WebRTC, não pelo servidor Express/WebSocket. Se TURN for o caminho escolhido, a mídia passa pelo serviço TURN.

Os tokens do transmissor e dos espectadores são aleatórios e distintos. O token de espectador está no fragmento (`#token=...`) do link, que não é enviado na requisição HTTP; o navegador o envia apenas na mensagem WebSocket de entrada. A sala é mantida apenas em memória, portanto uma reinicialização do Node encerra todas as salas ativas. A página detecta capacidades de H.264, VP8, VP9 e AV1 reportadas pelo navegador; a negociação SDP escolhe um codec comum sem forçar um formato específico.

### Limite de P2P

Cada espectador recebe uma cópia do fluxo. Para o perfil padrão de 1080p30 configurado em até 8 Mbps e quatro espectadores, o transmissor poderá precisar de cerca de 32 Mbps de upload mais a sobrecarga do protocolo. O bitrate configurado é um teto; dispositivo, encoder e rede podem limitar o valor real. Configure `MAX_VIEWERS` com cautela. Para muitos espectadores, planeje migrar para SFU, que recebe um fluxo e distribui cópias a partir de infraestrutura de servidor.

## Requisitos

- Windows 11 para os comandos locais deste guia.
- Node.js 20.6 ou posterior (recomendado Node.js 22 LTS) e npm.
- Navegador atualizado com WebRTC e captura de tela. A captura necessita HTTPS em produção; `localhost` é aceito para desenvolvimento.
- Em produção, um domínio com HTTPS/WSS e um serviço STUN; para redes restritas, TURN público com portas liberadas.

Áudio capturado da aba, janela ou sistema não está disponível de forma uniforme. O navegador apresenta o seletor e pode não fornecer faixa de áudio mesmo quando a aplicação a solicita. A captura sempre depende de escolha e permissão do usuário.

## Instalação e execução no Windows 11

Abra PowerShell na pasta do projeto:

```powershell
node --version
npm --version
Copy-Item .env.example .env
npm install
npm run dev
```

Abra <http://localhost:3000>. O endpoint de saúde responde em <http://localhost:3000/api/health> com `{"status":"ok","service":"webshare"}`. O script `npm run dev` reinicia o processo quando os arquivos do servidor mudam. Para execução normal, use `npm start`.

Se a política de execução do PowerShell bloquear scripts do npm, use `npm.cmd install` e `npm.cmd run dev`.

### Iniciar com um clique (Windows)

Dê dois cliques em `Iniciar-Transmitir.cmd`. O iniciador abre o servidor e um Cloudflare Quick Tunnel, aguarda o endereço público responder, abre a página do transmissor por HTTPS e salva o endereço em `.runtime/launcher/endereco-publico.txt`. Inicie a transmissão nessa página e compartilhe o link de espectador que o app mostrar. O servidor e o túnel permanecem em segundo plano; para encerrar, dê dois cliques em `Parar-Transmitir.cmd`. O endereço gratuito do Quick Tunnel pode mudar quando o túnel for iniciado novamente. O iniciador não altera a política de execução do Windows e chama `node.exe` diretamente.

## Acesso por outro dispositivo na rede local

1. Descubra o IPv4 do computador transmissor com `ipconfig`.
2. Em `.env`, configure `HOST=0.0.0.0` e `PUBLIC_ORIGIN=http://IP-DO-COMPUTADOR:3000` (substitua pelo IPv4 real).
3. Reinicie o servidor e permita a porta TCP 3000 no Firewall do Windows para a rede privada, se solicitado.
4. No outro dispositivo da mesma rede, abra `http://IP-DO-COMPUTADOR:3000`.

Isso só oferece acesso na rede local. Não publica o serviço na internet. Celulares podem exigir HTTPS para acesso às APIs de mídia; use o fluxo local apenas para desenvolvimento e valide cada navegador/dispositivo.

## Configuração

Copie `.env.example` para `.env`. Variáveis principais:

| Variável | Uso |
|---|---|
| `NODE_ENV` | Use `production` na implantação. |
| `HOST`, `PORT` | Endereço de escuta e porta HTTP. |
| `PUBLIC_ORIGIN` | Origem pública usada para criar links; HTTPS obrigatório em produção. |
| `ROOM_TTL_SECONDS` | Prazo sem atividade antes de expirar (300 segundos a 7 dias; padrão 6 horas). A sala ativa renova esse prazo automaticamente. |
| `MAX_VIEWERS` | Máximo de espectadores por sala (padrão 4). |
| `MAX_ROOMS` | Limite global de salas simultâneas na memória (padrão 500). |
| `MAX_CONNECTIONS_PER_IP` | Máximo de sockets WebSocket abertos por endereço IP (padrão 20). |
| `MAX_MESSAGE_BYTES` | Limite de cada mensagem WebSocket. |
| `STUN_URLS` | Lista separada por vírgula de URLs STUN. |
| `TURN_URLS` | Lista separada por vírgula de URLs TURN/TURNS. |
| `TURN_SHARED_SECRET` | Segredo compartilhado com coturn para credenciais temporárias. Nunca use um segredo público ou permanente no frontend. |
| `TURN_CREDENTIAL_TTL_SECONDS` | Validade das credenciais TURN emitidas pelo backend. |

Os endpoints de criação de sala e de configuração ICE têm limites básicos por endereço IP; a sinalização também limita mensagens por conexão. Em produção, configure limites equivalentes no proxy reverso, especialmente quando várias instâncias ou clientes compartilham o mesmo endereço do proxy.

Sem TURN configurado, a aplicação ainda tenta STUN, mas algumas redes não conseguirão conectar. Credenciais temporárias seguem o mecanismo REST do coturn: usuário com expiração e senha HMAC-SHA1 calculada com o segredo compartilhado. Restrinja `/api/ice` por TLS e monitore o uso.

## HTTPS, WSS e publicação

Em produção, coloque Express atrás de um proxy reverso (por exemplo, Caddy ou Nginx) que termine TLS e encaminhe HTTP e WebSocket. Configure `PUBLIC_ORIGIN=https://seu-dominio.example` e `NODE_ENV=production`. O proxy deve encaminhar o upgrade WebSocket para `/signal`, preservar o cabeçalho `Origin` e permitir conexões de longa duração. Use um domínio/certificado válido; não publique credenciais TURN em JavaScript, HTML ou repositório.

Há agora uma implantação pronta para um VPS Linux com Docker Compose: `Dockerfile`, `compose.yaml` e `Caddyfile`. Ela executa o app, o Caddy para HTTPS/WSS e coturn no IP público do VPS. Consulte o roteiro completo em [docs/DEPLOY-PUBLICO.md](docs/DEPLOY-PUBLICO.md). A configuração de coturn exige IP público fixo e liberação das portas UDP/TCP; um serviço de hospedagem web comum nem sempre permite isso.

O endpoint `/api/ice` devolve apenas URLs STUN se `TURN_SHARED_SECRET` estiver vazio. Para usar coturn, configure `TURN_URLS`, `TURN_SHARED_SECRET` idêntico ao `static-auth-secret` do coturn, TLS/certificados se necessário, e libere a porta de controle e a faixa UDP de relay do servidor. Um serviço TURN gerenciado pode substituir coturn. STUN/TURN não substituem o servidor HTTP/WebSocket nem tornam `localhost` público.

Checklist de implantação:

1. Provisionar domínio, TLS, servidor Node e, se necessário, TURN.
2. Definir `.env` fora do controle de versão; usar `PUBLIC_ORIGIN` HTTPS e segredos fortes.
3. Executar `npm ci` com lockfile revisado e `npm start` sob gerenciador de processos.
4. Configurar proxy para `/` e `/signal`, health check em `/api/health`, limites e timeouts apropriados.
5. Validar sala entre redes distintas, inclusive com TURN obrigatório, antes de anunciar o serviço.

O servidor guarda salas apenas em memória e não grava mídia. Uma implantação com múltiplas instâncias exigiria armazenamento/pub-sub compartilhado para sinalização e salas. Esta versão é de instância única.

## Segurança e privacidade

- A origem do WebSocket deve corresponder exatamente à origem pública; Quick Tunnel só aceita a origem HTTPS encaminhada pelo proxy confiável, sem curinga para outros túneis.
- O servidor escuta em `127.0.0.1` por padrão. Mantenha assim quando usar Cloudflare Tunnel; só use `0.0.0.0` se realmente precisar expor o serviço à rede local.
- Criação de salas, configuração ICE e sinalização têm limites de taxa; salas simultâneas, conexões por IP, espectadores e tamanho das mensagens também têm limites.
- Em produção, o servidor exige `Origin` válido para criação de salas e WebSocket, bloqueia a ausência de `Origin` e envia HSTS quando a conexão chega por HTTPS.
- Tokens são aleatórios; o servidor guarda hashes de tokens de sala na memória. O link de espectador é uma credencial: compartilhe apenas com pessoas autorizadas.
- Configure HTTPS/WSS em produção e proteja `.env`, logs, backups e acesso ao host.
- WebRTC normalmente cifra mídia em trânsito. Isso não impede um espectador de capturar a tela com outro dispositivo ou ferramenta.
- Não há gravação no serviço. O transmissor precisa iniciar a captura no seletor do navegador e pode encerrá-la a qualquer momento.
- Esta versão não inclui senha de sala, persistência, autenticação de usuários nem revogação individual de um link de espectador.

## Diagnóstico

- **`/api/health` não responde:** confira `npm run dev`, porta, firewall e `.env`.
- **Captura indisponível:** use navegador atualizado e HTTPS ou localhost, e clique para iniciar antes de escolher a fonte.
- **Espectador vê sala indisponível:** links expiram; o transmissor precisa estar online; confira se o link completo foi copiado.
- **Sala entra, mas mídia não conecta:** confira ICE no console do navegador. Teste TURN, credenciais temporárias e portas/firewall. STUN sozinho não atravessa todas as redes.
- **Sem áudio:** verifique a fonte selecionada e as opções do navegador/OS; compartilhar uma tela não garante faixa de áudio.
- **Qualidade baixa ou travada:** reduza o perfil e o número de espectadores; confira upload, CPU e perda de pacotes. Métricas variam entre navegadores.
- **WS retorna 403:** confira domínio/origem e se proxy encaminha `Upgrade`/`Connection` para `/signal`.

## Testes

Automatizados (Node.js, sem dependências extras de teste):

```powershell
npm test
```

Os testes cobrem criação, expiração e encerramento de salas, tokens e autorização, limite de espectadores, validação de mensagens, rate limit e roteamento de offer/answer/ICE em sockets simulados. Eles não substituem teste real de WebRTC.

### Roteiro manual

1. Transmissor e espectador em duas abas no mesmo computador.
2. Dois computadores na mesma rede local.
3. Computador transmissor e celular espectador na mesma rede.
4. Dispositivos em redes diferentes (por exemplo, Wi-Fi e rede móvel).
5. Rede com NAT restritivo/firewall, confirmando falha sem TURN quando aplicável.
6. Repetir com TURN configurado e verificar par ICE relay nas ferramentas de diagnóstico do navegador.
7. Trocar entre os quatro perfis com espectadores conectados.
8. Desconectar/reconectar rede e observar a mensagem de recuperação.
9. Encerrar pelo botão do transmissor e pela barra do navegador; confirmar liberação do preview no transmissor.
10. Testar até `MAX_VIEWERS` e confirmar que a entrada seguinte é recusada.
11. Repetir em Chrome, Edge, Firefox e Safari recentes e em Android/iPhone, observando áudio e tela cheia.

Os passos 2–11 dependem de dispositivos, navegadores, redes ou infraestrutura TURN reais. Resultado pode variar com sistema operacional, permissões, NAT, firewall e capacidade de upload.

## Manutenção

- Atualize dependências com revisão de changelog e `npm audit`; valide versões em ambiente de teste.
- Faça backup seguro do `.env` fora do repositório e rotacione o segredo TURN se houver exposição.
- Acompanhe erros do Node, conexões WebSocket, taxa de uso TURN e custos de tráfego sem registrar tokens ou conteúdo de mídia.
- Antes de aumentar espectadores, faça teste de carga e avalie SFU. O P2P aumenta upload por espectador.
