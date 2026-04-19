import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));

function main() {
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve('pokemon-showdown/package.json');
  } catch {
    const fallbackPath = join(scriptDir, '..', 'packages', 'showdown-adapter', 'node_modules', 'pokemon-showdown', 'package.json');
    if (!existsSync(fallbackPath)) {
      console.log('pokemon-showdown is not installed; skipping preparation.');
      return;
    }
    packageJsonPath = fallbackPath;
  }

  const packageDir = dirname(packageJsonPath);
  const distEntry = join(packageDir, 'dist', 'sim', 'index.js');
  const buildScript = join(packageDir, 'build');

  if (existsSync(distEntry)) {
    console.log('pokemon-showdown is already built.');
    return;
  }

  if (!existsSync(buildScript)) {
    console.log('pokemon-showdown build script not found; skipping preparation.');
    return;
  }

  console.log('Building pokemon-showdown from source...');
  execSync('node build', {
    cwd: packageDir,
    stdio: 'inherit',
  });
}

main();
