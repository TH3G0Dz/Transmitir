# Fase 1 — Arquitetura

## Fluxo proposto

1. O transmissor cria a sala pelo endpoint HTTP. O backend cria identificador aleatório, token do transmissor, token de espectador e expiração.
2. Após clique explícito, `getDisplayMedia()` pede ao usuário que selecione monitor, janela ou aba; áudio é opcional.
3. Transmissor e espectadores autenticam no WebSocket por seus papéis e tokens.
4. Para cada espectador, o transmissor cria uma `RTCPeerConnection`, oferta SDP e candidatos ICE; o espectador responde. O WebSocket só transporta a sinalização.
5. ICE seleciona uma rota direta quando possível ou TURN quando necessário. TURN retransmite os pacotes de mídia.
6. O transmissor encerra as faixas e a sala; desconexões e expiração notificam os espectadores e liberam conexões.

## Decisões e limites

- P2P com uma conexão por espectador para a versão inicial; upload do transmissor cresce aproximadamente com o número de espectadores.
- Um servidor HTTP/HTTPS e WebSocket/WSS público é necessário para compartilhar links entre redes. STUN ajuda na descoberta; TURN é necessário em alguns caminhos de rede e incorre em tráfego/custo.
- HTTPS é necessário para APIs de mídia em produção; localhost é exceção de desenvolvimento, não hospedagem pública.
- Tokens de host e viewer são diferentes. O token viewer fica no fragmento do link e é enviado pelo cliente somente no WebSocket.
- Qualidade, FPS, áudio e codec dependem de navegador, dispositivo, SO e rede. Perfis são alvos, sem garantia.
- As salas são mantidas em memória e desaparecem em reinício. Uma futura SFU e armazenamento/pub-sub compartilhado são necessários para maior escala/múltiplas instâncias.

## Estrutura

Veja `README.md` para a árvore completa do projeto e a documentação de implantação e validação.
