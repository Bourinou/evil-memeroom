param([string]$PreviousExe)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.test-artifacts'))
$installTarget = [IO.Path]::GetFullPath((Join-Path $artifactRoot 'installed-validation'))
if (-not $installTarget.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Le dossier d’installation doit rester dans les artefacts de test."
}
if (Test-Path -LiteralPath $installTarget) { throw 'Le dossier de test existe déjà.' }
$version = (Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $artifactRoot "installer/memeroom-validation-Setup-$version.exe"
$executable = Join-Path $installTarget 'MemeRoom Validation.exe'
$uninstaller = Join-Path $installTarget 'Uninstall MemeRoom Validation.exe'
$previousTarget = $env:MEMEROOM_TEST_EXE
$previousSource = $env:MEMEROOM_PREVIOUS_EXE
try {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installTarget") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $executable)) { throw "Échec de l’installation de test." }
  $env:MEMEROOM_TEST_EXE = $executable
  if ($PreviousExe) { $env:MEMEROOM_PREVIOUS_EXE = $PreviousExe }
  node (Join-Path $workspace 'tests/profile.e2e.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Le profil n’a pas survécu à la mise à jour." }
  # Reinstall the same dedicated identity to exercise NSIS's existing-install path.
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installTarget") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw 'Échec de la réinstallation de test.' }
  Write-Output 'OK · Installation NSIS, exécution du programme installé, reprise du profil et réinstallation.'
} finally {
  $env:MEMEROOM_TEST_EXE = $previousTarget
  $env:MEMEROOM_PREVIOUS_EXE = $previousSource
  if (Test-Path -LiteralPath $uninstaller) {
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    for ($attempt = 0; $attempt -lt 100 -and (Test-Path -LiteralPath $executable); $attempt++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path -LiteralPath $executable) { throw "La désinstallation de test n’a pas terminé." }
    Write-Output 'OK · Désinstallation de MemeRoom Validation.'
  }
}
