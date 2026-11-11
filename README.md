# TH Transmissões

Aplicativo desktop para Windows que compartilha uma tela ou janela ao vivo. O transmissor trabalha dentro do app; espectadores assistem pelo link privado no navegador, sem instalar nada.

## Usar no Windows

1. Na [página de releases](https://github.com/TH3G0Dz/Transmitir/releases/latest), baixe `TH-Transmissoes-Setup-1.0.2.exe`.
2. Instale e abra **TH Transmissões**.
3. Aguarde o app preparar o endereço seguro.
4. Clique em **Iniciar transmissão** e escolha uma tela ou janela.
5. Copie o link exibido e envie aos espectadores.

O `.exe` inclui o app, Node.js e Cloudflare Tunnel. O computador precisa somente de Windows 10/11 e internet.

Ao fechar a janela durante uma transmissão, o app fica na bandeja e continua funcionando. Clique no ícone da bandeja para reabrir. Use **Sair** no menu da bandeja para encerrar o app e o túnel.

Na primeira execução, o Firewall do Windows pode perguntar sobre acesso de rede. O app escuta somente no próprio computador e usa uma conexão de saída; não precisa liberar acesso público ou privado.

O Quick Tunnel cria um endereço temporário. Ao reabrir o app, compartilhe o novo link. O computador transmissor precisa permanecer ligado.

## Desenvolvimento

Requisitos: Node.js 20.6+, Git e `cloudflared.exe` instalado ou indicado em `CLOUDFLARED_PATH`.

Abra o PowerShell e execute:

```powershell
git clone https://github.com/TH3G0Dz/Transmitir.git
cd Transmitir
Copy-Item .env.example .env
npm.cmd install
```

Abra o aplicativo desktop em desenvolvimento:

```powershell
npm.cmd run desktop
```

Gere o instalador independente:

```powershell
npm.cmd run dist:win
```

O arquivo final fica em `release\TH-Transmissoes-Setup-1.0.2.exe`. O instalador cria o atalho **TH Transmissões** na área de trabalho.

## Como a transmissão funciona

1. O aplicativo pede ao transmissor uma tela ou janela e captura somente a fonte escolhida.
2. O servidor cria uma sala temporária e gera um link com credencial de acesso para os espectadores.
3. O transmissor e cada espectador usam o WebSocket para trocar informações necessárias à conexão. O servidor também envia sinais periódicos para manter a sala ativa.
4. O áudio e o vídeo são enviados por WebRTC. Normalmente seguem diretamente do transmissor para cada espectador; se a rede exigir TURN, o tráfego de mídia passa pelo serviço TURN configurado.
5. Cada espectador recebe uma cópia do fluxo. Por isso, mais espectadores exigem mais upload do computador transmissor.

O túnel público disponibiliza a página e o servidor de sinalização; ele não hospeda nem distribui automaticamente o vídeo. As salas ficam em memória: reiniciar o servidor encerra as salas em andamento. Enquanto o transmissor permanecer conectado, a validade da sala é renovada e não há limite fixo de duração. Uma queda momentânea do WebSocket do transmissor tem uma janela de 30 segundos para reconexão; se ele não voltar, a sala termina. Uma sala criada e não iniciada expira em até cinco minutos. Salas inativas também expiram pelo período definido em `ROOM_TTL_SECONDS` (12 horas por padrão).

## Qualidade, áudio e fontes

- O painel oferece perfis de 720p, 1080p e 1440p. Os valores de Mbps são limites máximos; o dispositivo e a conexão determinam o valor real.
- O app tenta preservar a resolução quando a conexão fica limitada. Uma conexão com pouco upload ainda pode reduzir a qualidade.
- Em P2P, o perfil padrão pode usar até cerca de 8 Mbps de upload por espectador. Quatro espectadores podem exigir aproximadamente 32 Mbps de upload, além da sobrecarga da rede.
- Para transmitir áudio, habilite **Compartilhar áudio do computador**. No Windows, o app captura o áudio reproduzido pelo sistema.
- **Mudar tela ou janela** substitui a fonte nas conexões atuais. A mudança não cria outra sala nem troca o link.

## Segurança e privacidade

- O aplicativo só captura a tela depois da escolha explícita do transmissor.
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

Os testes automatizados verificam configuração, desktop, tokens, salas, expiração, autenticação ICE, limites, reconexão e sinalização. Eles não substituem um teste real entre redes diferentes.

## Diagnóstico rápido

- **O comando `npm` é bloqueado pelo PowerShell:** use `npm.cmd`, como nos exemplos.
- **O aplicativo não abre:** reinstale o `.exe` e confirme que o antivírus não bloqueou o app ou `cloudflared.exe`.
- **O endereço público não funciona:** confira a internet e se firewall ou antivírus bloquearam o Cloudflare Tunnel.
- **A sala fica indisponível:** inicie a transmissão antes de abrir o link e compartilhe o link completo mostrado pelo painel. Reiniciar o servidor encerra a sala antiga.
- **O espectador entra, mas não vê vídeo:** teste primeiro na mesma rede; confira firewall, NAT e configuração TURN.
- **Sem áudio:** confirme que **Compartilhar áudio do computador** estava marcado antes de escolher a fonte.
- **O navegador não aparece na lista:** restaure a janela; janelas minimizadas ou em outra área de trabalho não são oferecidas pelo Windows. Depois clique em **Atualizar**.
- **Imagem travando ou perdendo qualidade:** confira o upload do transmissor, a quantidade de espectadores, o perfil selecionado e o uso de CPU.
