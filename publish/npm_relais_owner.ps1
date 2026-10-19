# Relais owner : build, test puis publication de parkandkeep-mcp@0.2.0 sur npm, 2FA par le navigateur.
# A lancer dans une fenêtre VISIBLE (hors terminal interactif, npm sort en EOTP).
# La session surveille ensuite `npm view parkandkeep-mcp version --prefer-online` et enchaîne le registre MCP officiel.
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "C:\Users\treso\Downloads\parkandkeep-oss\mcp"
Write-Host "1/5 Build et tests (HTTP + stdio) :" -ForegroundColor Cyan
npm run build
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test en échec : publication annulée." }
Write-Host "2/5 Connexion npm : une page s'ouvre dans le navigateur." -ForegroundColor Cyan
npm login --auth-type=web
npm whoami
Write-Host "3/5 Contenu publié (contrôle) :" -ForegroundColor Cyan
npm pack --dry-run
Write-Host "4/5 Publication : valider la 2FA dans le navigateur si demandé." -ForegroundColor Cyan
npm publish --auth-type=web --access public
Write-Host "5/5 Version en ligne :" -ForegroundColor Cyan
npm view parkandkeep-mcp version --prefer-online
Write-Host ""
Write-Host "Ensuite (registre MCP officiel, NE PAS lancer avant que npm affiche 0.2.0) :" -ForegroundColor Yellow
Write-Host '  mcp-publisher login github -token "$(gh auth token -u tresor4k)"'
Write-Host '  mcp-publisher publish'
Write-Host "Terminé. Vous pouvez fermer cette fenêtre." -ForegroundColor Green
