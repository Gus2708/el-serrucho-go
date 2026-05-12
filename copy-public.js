const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'public');
const dest = path.join(__dirname, 'dist');

if (!fs.existsSync(src)) {
  console.log('No public folder found');
  process.exit(0);
}

if (!fs.existsSync(dest)) {
  fs.mkdirSync(dest, { recursive: true });
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log(`Copying ${src} to ${dest}...`);
copyRecursiveSync(src, dest);

// También copiamos el icono principal para que tenga una ruta estable
const iconSrc = path.join(__dirname, 'assets', 'icon.png');
const iconDest = path.join(__dirname, 'dist', 'icon.png');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, iconDest);
  console.log('Icon copied to dist/icon.png');
}

console.log('Files copied successfully');
