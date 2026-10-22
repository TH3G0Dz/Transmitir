# Transmitir

Aplicação web para compartilhar uma tela, janela ou guia do navegador ao vivo. O transmissor escolhe a fonte no seletor do navegador; outras pessoas assistem pelo link da sala, inclusive em dispositivos e redes diferentes.

## Começar no Windows

### Requisitos

- Windows 10 ou 11.
- Node.js 20.6 ou mais recente, que já inclui o npm.
- Git para baixar o projeto do GitHub.
- Para publicar um endereço acessível pela internet com o iniciador de um clique: Cloudflare Tunnel (`cloudflared`). O iniciador procura `cloudflared.exe` no `PATH` ou em `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
- Um navegador atualizado com WebRTC e captura de tela, como Chrome ou Edge.

### Instalar o projeto

Abra o PowerShell e execute:

```powershell
git clone https://github.com/TH3G0Dz/Transmitir.git
cd Transmitir
Copy-Item .env.example .env
npm.cmd install
```

Use `npm.cmd` no PowerShell. Isso evita o erro de política de execução que pode impedir o carregamento do script `npm.ps1`.

### Executar apenas no computador transmissor

Para desenvolvimento e uso local, execute:

```powershell
npm.cmd run dev
```

Abra <http://localhost:3000>. O endereço `localhost` só funciona no próprio computador; pessoas em outros locais não devem usar esse endereço. Para encerrar o servidor iniciado no terminal, pressione `Ctrl+C`.

### Compartilhar com pessoas pela internet

1. Abra o arquivo `.env` e deixe estas opções configuradas para o Cloudflare Quick Tunnel local:

   ```dotenv
   TRUST_PROXY_HOPS=1
   ALLOW_QUICK_TUNNEL=true
   ```

2. Confirme que instalou o Node.js e o `cloudflared` e que já executou `npm.cmd install`.
3. Dê dois cliques em `Iniciar-Transmitir.cmd`.
4. Aguarde o navegador abrir o endereço HTTPS do transmissor.
5. Clique em **Iniciar transmissão** e selecione uma tela, janela ou guia.
6. Copie o **link para espectadores** exibido no painel e envie às pessoas.
7. Para trocar a fonte durante a transmissão, clique em **Mudar tela ou guia**. A sala e o link continuam os mesmos.
8. Para encerrar, use o botão **Encerrar transmissão** no painel. Para desligar também o servidor e o túnel, execute `Parar-Transmitir.cmd`.

O Quick Tunnel cria um endereço público temporário. Se o túnel for recriado, o endereço do transmissor muda e será necessário compartilhar um novo link. O computador transmissor, o navegador, o servidor e o túnel precisam permanecer ligados durante a transmissão.

## Como a transmissão funciona

1. O navegador do transmissor pede autorização e captura somente a fonte escolhida pelo usuário.
2. O servidor cria uma sala temporária e gera um link com credencial de acesso para os espectadores.
3. O transmissor e cada espectador usam o WebSocket para trocar informações necessárias à conexão. O servidor também envia sinais periódicos para manter a sala ativa.
4. O áudio e o vídeo são enviados por WebRTC. Normalmente seguem diretamente do transmissor para cada espectador; se a rede exigir TURN, o tráfego de mídia passa pelo serviço TURN configurado.
5. Cada espectador recebe uma cópia do fluxo. Por isso, mais espectadores exigem mais upload do computador transmissor.

O túnel público disponibiliza a página e o servidor de sinalização; ele não hospeda nem distribui automaticamente o vídeo. As salas ficam em memória: reiniciar o servidor encerra as salas em andamento. Enquanto o transmissor permanecer conectado, a validade da sala é renovada e não há limite fixo de duração. Uma queda momentânea do WebSocket do transmissor tem uma janela de 30 segundos para reconexão; se ele não voltar, a sala termina. Uma sala criada e não iniciada expira em até cinco minutos. Salas inativas também expiram pelo período definido em `ROOM_TTL_SECONDS` (12 horas por padrão).

## Qualidade, áudio e fontes

- O painel oferece perfis de 720p, 1080p e 1440p. Os valores de Mbps são limites máximos solicitados; o navegador, o dispositivo e a conexão determinam o valor real.
- O app pede ao navegador que preserve a resolução quando a conexão fica limitada. Uma conexão com pouco upload ainda pode reduzir a qualidade.
- Em P2P, o perfil padrão pode usar até cerca de 8 Mbps de upload por espectador. Quatro espectadores podem exigir aproximadamente 32 Mbps de upload, além da sobrecarga da rede.
- Para transmitir áudio, habilite **Solicitar áudio compartilhado**, escolha uma guia compatível e marque a opção de áudio que o navegador apresentar. Capturas de tela e áudio variam entre navegador, sistema operacional e dispositivo móvel.
- **Mudar tela ou guia** substitui a fonte de áudio/vídeo nas conexões atuais. A mudança não cria outra sala nem troca o link.

## Segurança e privacidade

- O navegador só captura a tela depois da escolha e autorização explícitas do transmissor.
- O link do espectador funciona como credencial: qualquer pessoa que o receber poderá tentar entrar enquanto a sala estiver ativa. Compartilhe-o apenas com quem você deseja convidar.
- A configuração STUN/TURN é entregue somente após autenticação com o token da sala; respostas com credenciais TURN não são armazenadas em cache.
- O app não grava a mídia. O servidor mantém salas e credenciais apenas em memória.
- WebRTC normalmente cifra a mídia durante o transporte. Isso não impede que um espectador grave ou filme a tela por outros meios.
- Não publique o arquivo `.env` nem compartilhe segredos TURN. O `.gitignore` exclui `.env` do repositório.

## Configuração

Copie `.env.example` para `.env`. Variáveis usadas com mais frequência:

| Variável | Para que serve |
|---|---|
| `HOST` e `PORT` | Endereço de escuta e porta do servidor local. O padrão usa `127.0.0.1:3000`. |
| `PUBLIC_ORIGIN` | Origem pública usada nos links. Em produção deve usar HTTPS. |
| `ALLOW_QUICK_TUNNEL` | Permite aceitar o domínio Quick Tunnel encaminhado pelo proxy local. Use `true` apenas ao utilizar esse túnel. |
| `TRUST_PROXY_HOPS` | Quantidade de proxies confiáveis. Para o Quick Tunnel local, use `1`. |
| `ROOM_TTL_SECONDS` | Prazo de inatividade antes de expirar uma sala. Padrão: 12 horas; a sala ativa renova esse prazo. |
| `MAX_VIEWERS` | Máximo de espectadores por sala. Padrão: quatro. |
| `MAX_ROOMS` | Máximo de salas simultâneas em memória. |
| `MAX_TOTAL_CONNECTIONS` | Limite global de conexões de sinalização simultâneas. Padrão: 1.000. |
| `STUN_URLS` | Servidores STUN usados para procurar um caminho WebRTC direto. |
| `TURN_URLS` e `TURN_SHARED_SECRET` | Serviço TURN e segredo usado para gerar credenciais temporárias, caso seja necessário retransmitir mídia. |
| `TURN_CREDENTIAL_TTL_SECONDS` | Duração das credenciais TURN. Padrão: 12 horas, para permitir sessões longas quando o tráfego usar TURN. |

STUN sozinho não conecta todas as redes. Para redes restritivas, configure TURN. As portas de TURN precisam estar liberadas no servidor e no firewall.

## Publicar em um servidor próprio

Para uma implantação persistente, use um servidor Linux com domínio, HTTPS/WSS e, se necessário, TURN. Este projeto inclui Docker Compose, Caddy e coturn como base. Siga o guia detalhado em [docs/DEPLOY-PUBLICO.md](docs/DEPLOY-PUBLICO.md). Um Quick Tunnel é prático para testar, mas não substitui uma hospedagem permanente.

## Testes

Com as dependências instaladas, execute:

```powershell
npm.cmd test
```

Os testes automatizados verificam configuração, tokens, salas, expiração e renovação por atividade, autenticação das credenciais ICE, limite global de WebSockets, reconexão do transmissor e mensagens de sinalização. Eles não substituem um teste real entre navegadores e redes diferentes.

## Diagnóstico rápido

- **O comando `npm` é bloqueado pelo PowerShell:** use `npm.cmd`, como nos exemplos.
- **O painel não abre:** confira se o servidor iniciou e se a porta 3000 está livre; consulte `.runtime\launcher\server-error.log` quando usar o iniciador.
- **O endereço público não funciona:** confirme `TRUST_PROXY_HOPS=1`, `ALLOW_QUICK_TUNNEL=true`, conexão com a internet e se o processo `cloudflared` continua ativo.
- **A sala fica indisponível:** inicie a transmissão antes de abrir o link e compartilhe o link completo mostrado pelo painel. Reiniciar o servidor encerra a sala antiga.
- **O espectador entra, mas não vê vídeo:** teste primeiro na mesma rede; confira firewall, NAT e configuração TURN.
- **Sem áudio:** confirme que o seletor do navegador permitiu compartilhar áudio da guia. A opção não é oferecida por todas as fontes e dispositivos.
- **Imagem travando ou perdendo qualidade:** confira o upload do transmissor, a quantidade de espectadores, o perfil selecionado e o uso de CPU.
