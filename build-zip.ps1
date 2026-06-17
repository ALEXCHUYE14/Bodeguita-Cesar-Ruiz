# build-zip.ps1
# Compila el proyecto y empaqueta el build en un ZIP listo para despliegue

$projectName = "crm-cesar-ruiz"
$fecha = Get-Date -Format "yyyy-MM-dd"
$zipName = "${projectName}-build-${fecha}.zip"

Write-Host "Construyendo proyecto..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error en el build. Abortando." -ForegroundColor Red
    exit 1
}

Write-Host "Empaquetando carpeta dist/ en $zipName..." -ForegroundColor Cyan
Compress-Archive -Path "dist\*" -DestinationPath $zipName -Force

Write-Host "Listo: $zipName" -ForegroundColor Green
Write-Host "Sube el contenido de dist/ a Vercel, Netlify o tu servidor." -ForegroundColor Gray
