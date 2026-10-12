const startLink = document.querySelector(".button.primary");
try {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error();
  startLink?.removeAttribute("aria-disabled");
} catch {
  if (startLink) startLink.title = "O serviço ainda está iniciando. Tente novamente em instantes.";
}
