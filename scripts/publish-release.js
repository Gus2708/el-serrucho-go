const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = pkg.version;
const tagName = `v${version}`;
const apkName = `el-serrucho-go-${tagName}.apk`;
const tempApkPath = path.join(rootDir, apkName);

const args = process.argv.slice(2);
const shouldWait = args.includes('--wait');
const explicitBuildId = args.find((a) => !a.startsWith('--'));

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function parseEasJson(output) {
  const firstBrace = output.indexOf('{');
  const firstBracket = output.indexOf('[');

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = output.lastIndexOf(']');
    return JSON.parse(output.substring(firstBracket, lastBracket + 1));
  }

  if (firstBrace !== -1) {
    const lastBrace = output.lastIndexOf('}');
    return [JSON.parse(output.substring(firstBrace, lastBrace + 1))];
  }

  throw new Error('No se pudo parsear la respuesta JSON de EAS:\n' + output);
}

async function getBuildInfo(buildId, retries = 3) {
  const cmd = buildId
    ? `npx eas build:view ${buildId} --json`
    : `npx eas build:list --platform android --limit 1 --json --non-interactive`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const raw = runCommand(cmd);
      if (!raw || raw.trim().length === 0) {
        throw new Error('Respuesta vacía recibida de EAS');
      }
      const builds = parseEasJson(raw);
      if (builds && builds.length > 0) {
        return builds[0];
      }
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function downloadFile(url, destPath) {
  console.log(`[Descarga] Descargando APK desde: ${url}...`);
  // Usamos curl.exe para streaming rápido con progreso nativo
  execSync(`curl.exe -L -o "${destPath}" "${url}"`, { stdio: 'inherit' });
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
    throw new Error('La descarga falló o el archivo APK está vacío.');
  }
}

async function ensureReleaseExists(tag) {
  try {
    runCommand(`gh release view ${tag}`);
  } catch {
    console.log(`[GitHub] Creando release ${tag}...`);
    runCommand(`gh release create ${tag} --title "${tag}" --generate-notes`);
  }
}

async function uploadToRelease(tag, filePath) {
  console.log(`[GitHub] Subiendo ${path.basename(filePath)} al release ${tag}...`);
  execSync(`gh release upload ${tag} "${filePath}" --clobber`, { stdio: 'inherit' });
}

async function main() {
  console.log(`\n========================================`);
  console.log(` Publicador de Release - El Serrucho GO`);
  console.log(` Versión objetivo: ${version} (${tagName})`);
  console.log(`========================================\n`);

  let build = await getBuildInfo(explicitBuildId);
  if (!build) {
    console.error('No se encontró ningún build en EAS.');
    process.exit(1);
  }

  console.log(`Build ID:      ${build.id}`);
  console.log(`Plataforma:    ${build.platform}`);
  console.log(`Perfil:        ${build.buildProfile}`);
  console.log(`Versión EAS:   ${build.appVersion}`);
  console.log(`Estado actual: ${build.status}\n`);

  let lastStatus = build.status;

  while (build.status === 'IN_QUEUE' || build.status === 'IN_PROGRESS') {
    if (!shouldWait) {
      console.log(`El build aún no termina (Estado: ${build.status}).`);
      console.log(`Podés ver los logs en: https://expo.dev/accounts/gusdev27/projects/el-serrucho-go/builds/${build.id}`);
      console.log(`\nPara esperar automáticamente a que termine, ejecutá:`);
      console.log(`  npm run release:publish -- --wait\n`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10000));

    try {
      const nextBuild = await getBuildInfo(build.id);
      if (nextBuild) {
        build = nextBuild;
        if (build.status !== lastStatus) {
          console.log(`[EAS] ¡Cambio de estado!: ${lastStatus} -> ${build.status}`);
          lastStatus = build.status;
        } else {
          console.log(`[EAS] Estado: ${build.status}...`);
        }
      }
    } catch (err) {
      console.log(`[EAS] Consulta temporal fallida (${err.message}), reintentando...`);
    }
  }

  if (build.status !== 'FINISHED') {
    console.error(`El build finalizó con estado: ${build.status}.`);
    process.exit(1);
  }

  const archiveUrl = build.artifacts?.applicationArchiveUrl || build.artifacts?.buildUrl;
  if (!archiveUrl) {
    console.error('El build terminó pero no se encontró la URL del archivo APK (archiveUrl).');
    process.exit(1);
  }

  try {
    await downloadFile(archiveUrl, tempApkPath);
    await ensureReleaseExists(tagName);
    await uploadToRelease(tagName, tempApkPath);

    console.log(`\n[Éxito] ¡APK subido correctamente al Release ${tagName}!`);
    console.log(`URL: https://github.com/Gus2708/el-serrucho-go/releases/tag/${tagName}\n`);
  } finally {
    if (fs.existsSync(tempApkPath)) {
      try {
        fs.unlinkSync(tempApkPath);
      } catch {
        // Ignorar error al limpiar archivo temporal
      }
    }
  }
}

main().catch((err) => {
  console.error('\n[Error en publicación]:', err.message);
  process.exit(1);
});
